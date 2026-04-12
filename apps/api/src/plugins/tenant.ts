import type { FastifyInstance, FastifyRequest } from "fastify";
import { defaultTenant, type TenantContext } from "@insightview/core";

declare module "fastify" {
  interface FastifyRequest {
    tenant: TenantContext;
  }
  interface FastifyInstance {
    metricsRegistry: import("@insightview/observability").Registry;
  }
}

/**
 * MVP tenant resolver: every request is the "default" tenant. This is the
 * single point of change when real multi-tenancy lands — swap `defaultTenant`
 * for JWT-based resolution and the entire codebase follows.
 */
export async function tenantPlugin(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req: FastifyRequest) => {
    const token = process.env.API_TOKEN;
    if (token) {
      const header = req.headers.authorization;
      if (header !== `Bearer ${token}`) {
        // Health and metrics don't need auth.
        if (
          req.url === "/healthz" ||
          req.url === "/readyz" ||
          req.url === "/metrics"
        ) {
          req.tenant = defaultTenant("system");
          return;
        }
        throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
      }
    }
    req.tenant = defaultTenant("api");
  });
}
