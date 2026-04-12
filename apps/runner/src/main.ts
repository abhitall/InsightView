import Fastify from "fastify";
import { createLogger } from "@insightview/observability";
import { createEventBus } from "@insightview/event-bus";
import {
  Topics,
  envelope,
  MessageTypes,
  defaultTenant,
  type CheckScheduledPayload,
  type CheckStartedPayload,
  type CheckCompletedPayload,
} from "@insightview/core";
import { markRunStarted, markRunCompleted, findRunById, createRun, getCheckByName, getCheckById } from "@insightview/db";
import { executeBrowserRun } from "./executeRun.js";

const log = createLogger({ service: "runner" });
const runnerId = process.env.RUNNER_ID ?? `runner-${Math.random().toString(36).slice(2, 8)}`;
const port = Number(process.env.PORT ?? 4200);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = Fastify({ logger: false });
  let healthy = true;
  app.get("/healthz", async () => ({ ok: healthy, runner: runnerId }));
  await app.listen({ port, host });
  log.info({ port, runnerId }, "runner health endpoint up");

  const bus = createEventBus();

  const sub = await bus.subscribe<CheckScheduledPayload>(
    Topics.ChecksScheduled,
    async (env) => {
      const msg = env.payload;
      const ctx = defaultTenant(`runner:${runnerId}`);

      // The scheduler's cron path has a __TEMPLATE__ runId because BullMQ
      // cron jobs are emitted once per schedule. We allocate a real runId
      // and row here.
      let effectiveRunId = msg.runId;
      if (effectiveRunId === "__TEMPLATE__") {
        effectiveRunId = `run_${Math.random().toString(36).slice(2)}_${Date.now()}`;
        const check = await getCheckById(ctx, msg.checkId).catch(() => null);
        if (!check) {
          log.warn({ checkId: msg.checkId }, "schedule fired for missing check; skipping");
          return;
        }
        await createRun(ctx, {
          runId: effectiveRunId,
          checkId: check.id,
          scheduledAt: new Date(),
          triggeredBy: "SCHEDULE",
        });
      }

      const claimed = await markRunStarted(ctx, effectiveRunId, runnerId);
      if (!claimed) {
        log.warn({ runId: effectiveRunId }, "run already claimed or missing — skipping");
        return;
      }

      const startedPayload: CheckStartedPayload = {
        runId: effectiveRunId,
        checkId: msg.checkId,
        runnerId,
        startedAt: new Date().toISOString(),
      };
      await bus.publish(
        Topics.ChecksStarted,
        envelope(MessageTypes.CheckStarted, startedPayload, {
          tenantId: env.tenantId,
        }),
      );

      try {
        const outcome = await executeBrowserRun({
          runId: effectiveRunId,
          checkId: msg.checkId,
          checkName: msg.checkName,
          targetUrl: msg.targetUrl,
          scriptRef: msg.scriptRef ?? "basic-homepage",
          timeoutMs: msg.timeoutMs,
          assertions: msg.assertions ?? [],
          tenantId: env.tenantId,
          log,
          runnerId,
        });

        await markRunCompleted(
          ctx,
          effectiveRunId,
          outcome.status,
          outcome.errorMessage,
        );

        const completedPayload: CheckCompletedPayload = {
          runId: effectiveRunId,
          checkId: msg.checkId,
          status: outcome.status,
          completedAt: new Date().toISOString(),
          durationMs: outcome.durationMs,
          resultIds: outcome.resultIds,
          summary: outcome.summary,
          errorMessage: outcome.errorMessage,
        };
        await bus.publish(
          Topics.ChecksCompleted,
          envelope(MessageTypes.CheckCompleted, completedPayload, {
            tenantId: env.tenantId,
          }),
        );
      } catch (err) {
        log.error({ err, runId: effectiveRunId }, "run execution crashed");
        await markRunCompleted(
          ctx,
          effectiveRunId,
          "ERROR",
          (err as Error).message,
        );
        await bus.publish(
          Topics.ChecksCompleted,
          envelope(
            MessageTypes.CheckCompleted,
            {
              runId: effectiveRunId,
              checkId: msg.checkId,
              status: "ERROR",
              completedAt: new Date().toISOString(),
              durationMs: 0,
              resultIds: [],
              summary: { passedAssertions: 0, failedAssertions: 0, webVitals: {} },
              errorMessage: (err as Error).message,
            },
            { tenantId: env.tenantId },
          ),
        );
      }
    },
    { concurrency: 1 },
  );

  const shutdown = async () => {
    log.info("runner shutting down");
    healthy = false;
    await sub.close();
    await bus.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

// Unused import suppression for getCheckByName (kept for completeness).
void getCheckByName;

main().catch((err) => {
  log.error({ err }, "runner failed to start");
  process.exit(1);
});
