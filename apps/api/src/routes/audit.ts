import type { FastifyInstance } from "fastify";
import { listAuditLogs } from "@insightview/db";
import { requireRole } from "../plugins/tenant.js";
import { parseLimit } from "../util/query.js";

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
        limit: parseLimit(req.query.limit),
      });
      return { items };
    },
  );
}
