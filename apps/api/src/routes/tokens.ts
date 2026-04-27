import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  mintToken,
  revokeToken,
  listTokens,
  recordAudit,
} from "@insightview/db";
import { requireRole } from "../plugins/tenant.js";

const MintBody = z.object({
  name: z.string().min(1).max(120),
  role: z.enum(["admin", "write", "read"]).default("read"),
  scopes: z.array(z.string()).optional(),
  expiresInDays: z.number().int().positive().optional(),
});

export async function registerTokenRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/v1/tokens",
    { preHandler: requireRole("admin") },
    async (req) => {
      const items = await listTokens(req.tenant);
      return { items };
    },
  );

  app.post(
    "/v1/tokens",
    { preHandler: requireRole("admin") },
    async (req, reply) => {
      const body = MintBody.parse(req.body);
      const expiresAt = body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
        : undefined;
      const result = await mintToken(req.tenant, {
        name: body.name,
        role: body.role,
        scopes: body.scopes,
        expiresAt,
      });
      await recordAudit(req.tenant, {
        actor: req.auth?.tokenId ?? "system",
        action: "token.mint",
        resource: "ApiToken",
        resourceId: result.id,
        metadata: { name: body.name, role: body.role, scopes: body.scopes },
      });
      reply.status(201);
      // The raw token is only ever returned here; losing it means
      // revoke and mint a new one.
      return result;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/tokens/:id",
    { preHandler: requireRole("admin") },
    async (req, reply) => {
      await revokeToken(req.tenant, req.params.id);
      await recordAudit(req.tenant, {
        actor: req.auth?.tokenId ?? "system",
        action: "token.revoke",
        resource: "ApiToken",
        resourceId: req.params.id,
      });
      reply.status(204);
    },
  );
}
