import type { Logger } from "@insightview/observability";
import { listStaleRunningRuns, markRunCompleted } from "@insightview/db";

export interface TimeoutReaperOpts {
  log: Logger;
  isLeader: () => boolean;
  intervalMs?: number;
}

/**
 * Reap runs that are stuck in RUNNING for way longer than their timeout.
 * The runner normally marks these TIMEOUT itself but if the runner crashes
 * mid-execution the row lingers. This sweep closes them cleanly.
 */
export function startTimeoutReaper(opts: TimeoutReaperOpts): () => void {
  const interval = opts.intervalMs ?? 60_000;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    if (!opts.isLeader()) return;
    try {
      const stale = await listStaleRunningRuns(10 * 60 * 1000);
      for (const run of stale) {
        opts.log.warn({ runId: run.id }, "reaping stale run");
        await markRunCompleted(
          { tenantId: run.tenantId, actor: "reaper" },
          run.id,
          "TIMEOUT",
          "Run exceeded 10 minute safety window",
        );
      }
    } catch (err) {
      opts.log.warn({ err }, "timeout reaper tick failed");
    }
  };

  const handle = setInterval(() => void tick(), interval);
  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
