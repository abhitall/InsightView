import type { FastifyInstance } from "fastify";
import { rumEventBatchSchema } from "@insightview/rum-sdk/schema";
import {
  upsertSession,
  insertRumEvents,
  type RumEventInput,
} from "@insightview/db";
import { defaultTenant, RumEventType } from "@insightview/core";
import { resolveGeo } from "../geo.js";

export async function registerEventRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/v1/events", async (req, reply) => {
    const parseResult = rumEventBatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      reply.status(400);
      return {
        error: "VALIDATION",
        issues: parseResult.error.issues.slice(0, 5),
      };
    }
    const batch = parseResult.data;

    const ctx = defaultTenant("rum");
    const userAgent = req.headers["user-agent"] ?? "unknown";
    const geo = resolveGeo(req.headers, req.ip);

    await upsertSession(ctx, {
      id: batch.sessionId,
      siteId: batch.siteId,
      userAgent: String(userAgent),
      country: geo.country,
      deviceCategory: classifyDevice(String(userAgent)),
      pageCount: 1,
    });

    const rows: RumEventInput[] = batch.events.map((ev) => ({
      id: ev.id,
      sessionId: batch.sessionId,
      siteId: batch.siteId,
      type: RumEventType[ev.type] ?? RumEventType.CUSTOM,
      name: ev.name,
      value: ev.value,
      rating: ev.rating,
      url: ev.url,
      occurredAt: new Date(ev.occurredAt),
      attributes: {
        ...(ev.attributes ?? {}),
        geo: {
          country: geo.country,
          region: geo.region,
          city: geo.city,
        },
      },
    }));

    const count = await insertRumEvents(ctx, rows);
    reply.status(202);
    return { accepted: count };
  });
}

function classifyDevice(ua: string): string {
  if (/Mobile|iPhone|Android/i.test(ua)) return "mobile";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  return "desktop";
}
