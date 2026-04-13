import type { FastifyInstance, FastifyRequest } from "fastify";
import { defaultTenant, type TenantContext } from "@insightview/core";
import { verifyToken, type VerifiedToken } from "@insightview/db";

declare module "fastify" {
  interface FastifyRequest {
    tenant: TenantContext;
    auth?: {
      tokenId: string;
      role: "admin" | "write" | "read";
      scopes: string[];
    };
  }
  interface FastifyInstance {
    metricsRegistry: import("@insightview/observability").Registry;
  }
}

/**
 * Tenant + auth resolver (ADR 0012).
 *
 * Authentication: the plugin looks at `Authorization: Bearer <token>`.
 * Three modes are supported:
 *
 *   1. **API_TOKEN** static env var. If set, any request whose
 *      bearer token matches is treated as `admin` role. This is
 *      the MVP single-shared-secret mode.
 *
 *   2. **Issued API tokens**. If the bearer token starts with the
 *      `iv_` prefix we look it up in the ApiToken table via
 *      `verifyToken`. Revoked or expired rows return 401. Valid
 *      rows populate `req.auth` with the token's role + scopes.
 *
 *   3. **No auth required**. When neither API_TOKEN nor a matching
 *      ApiToken row is present, the request is treated as the
 *      `default` tenant with `read` role — matches the MVP's
 *      unauthenticated behavior for local dev.
 *
 * Health + metrics endpoints are always accessible without auth
 * so Kubernetes liveness probes can hit them.
 */

const PUBLIC_PATHS = new Set(["/healthz", "/readyz", "/metrics"]);

function isPublic(url: string): boolean {
  // Match exact and query-stripped paths.
  const base = url.split("?")[0];
  return PUBLIC_PATHS.has(base) || base.startsWith("/v1/status/");
}

export async function tenantPlugin(app: FastifyInstance): Promise<void> {
  const staticToken = process.env.API_TOKEN;

  app.addHook("onRequest", async (req: FastifyRequest) => {
    if (isPublic(req.url)) {
      req.tenant = defaultTenant("system");
      return;
    }

    const header = req.headers.authorization;
    const bearer =
      header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    // 1. Static token path (back-compat)
    if (staticToken) {
      if (bearer === staticToken) {
        req.tenant = defaultTenant("api");
        req.auth = { tokenId: "static", role: "admin", scopes: ["*"] };
        return;
      }
      // 2. Issued-token path
      if (bearer?.startsWith("iv_")) {
        const verified = await verifyToken(bearer).catch(() => null);
        if (verified) {
          req.tenant = { tenantId: verified.tenantId, actor: verified.name };
          req.auth = {
            tokenId: verified.id,
            role: verified.role as "admin" | "write" | "read",
            scopes: verified.scopes,
          };
          return;
        }
      }
      // Neither matched — 401.
      const err = new Error("Unauthorized") as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }

    // No static token configured → check for issued token, else fall
    // through as the default tenant with read role.
    if (bearer?.startsWith("iv_")) {
      const verified = await verifyToken(bearer).catch(() => null);
      if (verified) {
        req.tenant = { tenantId: verified.tenantId, actor: verified.name };
        req.auth = {
          tokenId: verified.id,
          role: verified.role as "admin" | "write" | "read",
          scopes: verified.scopes,
        };
        return;
      }
    }
    req.tenant = defaultTenant("anonymous");
    req.auth = { tokenId: "anonymous", role: "read", scopes: [] };
  });
}

/**
 * Role-based route guard. Call as `{ preHandler: requireRole("write") }`
 * on a Fastify route.
 */
export function requireRole(minimum: "admin" | "write" | "read") {
  const order: Record<"admin" | "write" | "read", number> = {
    read: 0,
    write: 1,
    admin: 2,
  };
  return async (req: FastifyRequest) => {
    const auth = req.auth;
    if (!auth) {
      const err = new Error("Unauthorized") as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
    if (order[auth.role] < order[minimum]) {
      const err = new Error(`Forbidden (requires ${minimum})`) as Error & {
        statusCode: number;
      };
      err.statusCode = 403;
      throw err;
    }
  };
}
