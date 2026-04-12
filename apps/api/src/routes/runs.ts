import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getCheckByName,
  createRun,
  getRunById,
  listRunsByCheck,
  findRunById,
} from "@insightview/db";
import {
  createRunId,
  envelope,
  MessageTypes,
  Topics,
  TriggerSource,
  type CheckScheduledPayload,
} from "@insightview/core";
import { createEventBus } from "@insightview/event-bus";

const TriggerBody = z.object({
  checkName: z.string().min(1),
  triggeredBy: z.enum(["MANUAL", "API", "ACTION"]).default("API"),
});

// Singleton bus per process — the API is both a publisher and (via /healthz)
// a health reader. Subscribers live in other services.
const bus = createEventBus();

export async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/runs", async (req, reply) => {
    const body = TriggerBody.parse(req.body);
    const check = await getCheckByName(req.tenant, body.checkName);

    const runId = createRunId();
    const scheduledAt = new Date();
    await createRun(req.tenant, {
      runId,
      checkId: check.id,
      scheduledAt,
      triggeredBy: body.triggeredBy as TriggerSource,
    });

    const payload: CheckScheduledPayload = {
      runId,
      checkId: check.id,
      checkName: check.name,
      scheduledAt: scheduledAt.toISOString(),
      targetUrl: check.targetUrl,
      scriptRef: check.scriptRef,
      timeoutMs: check.timeoutMs,
      retries: check.retries,
      triggeredBy: body.triggeredBy as TriggerSource,
      assertions: (check.assertions as Array<{ type: string; value: string }>) ?? [],
    };

    const env = envelope(MessageTypes.CheckScheduled, payload, {
      tenantId: req.tenant.tenantId,
    });
    await bus.publish(Topics.ChecksScheduled, env, { dedupeKey: runId });

    reply.status(202);
    return { runId, status: "QUEUED" };
  });

  app.get<{ Params: { runId: string } }>(
    "/v1/runs/:runId",
    async (req) => {
      const run = await getRunById(req.tenant, req.params.runId);
      return run;
    },
  );

  app.get<{ Querystring: { runId?: string; checkName?: string; limit?: string } }>(
    "/v1/runs",
    async (req) => {
      if (req.query.runId) {
        const run = await findRunById(req.tenant, req.query.runId);
        return { items: run ? [run] : [] };
      }
      if (req.query.checkName) {
        const check = await getCheckByName(req.tenant, req.query.checkName);
        const runs = await listRunsByCheck(
          req.tenant,
          check.id,
          req.query.limit ? parseInt(req.query.limit, 10) : 50,
        );
        return { items: runs };
      }
      return { items: [] };
    },
  );
}
