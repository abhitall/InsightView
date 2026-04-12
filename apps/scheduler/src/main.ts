import Fastify from "fastify";
import IORedis from "ioredis";
import { createLogger } from "@insightview/observability";
import { createEventBus, createScheduler } from "@insightview/event-bus";
import { startLeaderLoop } from "./leaderElection.js";
import { startScheduleLoop } from "./scheduleLoop.js";
import { startWatchdog } from "./watchdog.js";
import { startTimeoutReaper } from "./timeoutReaper.js";

const log = createLogger({ service: "scheduler" });

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "0.0.0.0";
const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";

async function main() {
  const app = Fastify({ logger: false });
  app.get("/healthz", async () => ({ ok: true, service: "scheduler" }));
  await app.listen({ port, host });
  log.info({ port }, "scheduler health endpoint up");

  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const bus = createEventBus({ redisUrl });
  const scheduler = createScheduler({ redisUrl });

  const leaderId = `scheduler-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  log.info({ leaderId }, "scheduler starting");

  let isLeader = false;
  const stopLeader = startLeaderLoop(redis, leaderId, log, (leader) => {
    isLeader = leader;
    log.info({ isLeader: leader }, "leadership state changed");
  });

  const stopSchedule = startScheduleLoop({
    bus,
    scheduler,
    log,
    isLeader: () => isLeader,
  });

  const stopWatchdog = startWatchdog({
    log,
    leaderId,
    isLeader: () => isLeader,
  });

  const stopReaper = startTimeoutReaper({
    log,
    isLeader: () => isLeader,
  });

  const shutdown = async () => {
    log.info("shutdown requested");
    stopReaper();
    stopWatchdog();
    stopSchedule();
    stopLeader();
    await app.close();
    await bus.close();
    await scheduler.close();
    await redis.quit();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  log.error({ err }, "scheduler failed to start");
  process.exit(1);
});
