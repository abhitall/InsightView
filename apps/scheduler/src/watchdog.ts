import type { Logger } from "@insightview/observability";
import { beatHeartbeat } from "@insightview/db";

export interface WatchdogOpts {
  log: Logger;
  leaderId: string;
  isLeader: () => boolean;
  intervalMs?: number;
}

/**
 * Dead-man's-switch heartbeat loop. The leader upserts the
 * WatchdogHeartbeat row every N seconds. `/healthz` on the API reads it
 * and reports stale if it's older than 3× the interval.
 *
 * This is the critical gap fix from the GitHub Actions cron era: if the
 * scheduler process or its database connection dies, the heartbeat will
 * stop advancing and alerting picks up the outage within ~90s.
 */
export function startWatchdog(opts: WatchdogOpts): () => void {
  const interval = opts.intervalMs ?? 15_000;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    if (!opts.isLeader()) return;
    try {
      await beatHeartbeat(
        "scheduler-leader",
        opts.leaderId,
        Math.round(interval / 1000),
      );
    } catch (err) {
      opts.log.warn({ err }, "watchdog heartbeat failed");
    }
  };

  const handle = setInterval(() => void tick(), interval);
  void tick();

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
