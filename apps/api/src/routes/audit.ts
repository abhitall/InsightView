import type { FastifyInstance } from "fastify";
import { listAuditLogs } from "@insightview/db";
import { requireRole } from "../plugins/tenant.js";

export async function registerAuditRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{
    Querystring: {
      resource?: string;
      resourceId?: string;
      limit?: string;
    };
  }>(
    "/v1/audit",
    { preHandler: requireRole("write") },
    async (req) => {
      const items = await listAuditLogs(req.tenant, {
        resource: req.query.resource,
        resourceId: req.query.resourceId,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 100,
      });
      return { items };
    },
  );
}
