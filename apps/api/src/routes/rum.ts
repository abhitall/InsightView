import type { FastifyInstance } from "fastify";
import {
  listRumEvents,
  listRumSessions,
  rumWebVitalSummary,
} from "@insightview/db";
import { RumEventType } from "@insightview/core";

export async function registerRumRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      siteId?: string;
      type?: string;
      sessionId?: string;
      since?: string;
      limit?: string;
    };
  }>("/v1/rum/events", async (req) => {
    const type = req.query.type as keyof typeof RumEventType | undefined;
    const items = await listRumEvents(req.tenant, {
      siteId: req.query.siteId,
      type: type ? RumEventType[type] : undefined,
      sessionId: req.query.sessionId,
      since: req.query.since ? new Date(req.query.since) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 100,
    });
    return { items };
  });

  app.get<{ Querystring: { siteId?: string } }>(
    "/v1/rum/sessions",
    async (req) => {
      const items = await listRumSessions(req.tenant, req.query.siteId, 50);
      return { items };
    },
  );

  app.get<{ Querystring: { siteId?: string } }>(
    "/v1/rum/summary",
    async (req) => {
      const siteId = req.query.siteId ?? "";
      const summary = siteId
        ? await rumWebVitalSummary(req.tenant, siteId, 24 * 3600 * 1000)
        : [];
      return { siteId, summary };
    },
  );
}
