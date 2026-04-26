import Fastify from "fastify";
import { createLogger, createRegistry } from "@insightview/observability";
import { createEventBus } from "@insightview/event-bus";
import {
  Topics,
  defaultTenant,
  type CheckCompletedPayload,
} from "@insightview/core";
import { evaluateCompletion } from "./evaluator.js";
import { dispatchNotifications } from "./dispatcher.js";

const log = createLogger({ service: "alerting" });
const port = Number(process.env.PORT ?? 4300);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = Fastify({ logger: false });
  app.get("/healthz", async () => ({ ok: true, service: "alerting" }));
  const registry = createRegistry("alerting");
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", registry.contentType);
    return registry.metrics();
  });
  await app.listen({ port, host });
  log.info({ port }, "alerting health endpoint up");

  const bus = createEventBus();
  const sub = await bus.subscribe<CheckCompletedPayload>(
    Topics.ChecksCompleted,
    async (env) => {
      const ctx = defaultTenant("alerting");
      try {
        const fired = await evaluateCompletion(ctx, env.payload, log);
        for (const { incident, rule } of fired) {
          await dispatchNotifications(ctx, incident, rule, log);
        }
      } catch (err) {
        log.error({ err, runId: env.payload.runId }, "evaluation failed");
      }
    },
    { concurrency: 4 },
  );

  const shutdown = async () => {
    log.info("alerting shutting down");
    await sub.close();
    await bus.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  log.error({ err }, "alerting failed to start");
  process.exit(1);
});
