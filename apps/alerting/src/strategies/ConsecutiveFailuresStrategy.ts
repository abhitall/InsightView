import type { Strategy } from "./index.js";

/**
 * CONSECUTIVE_FAILURES strategy. Expression shape:
 *   { threshold: number }
 *
 * Fires when the latest N runs (including the current one) are all
 * non-PASSED. Resolves as soon as a PASSED run appears.
 */
export const consecutiveFailuresStrategy: Strategy = {
  evaluate(ctx) {
    const expr = (ctx.rule.expression ?? {}) as { threshold?: number };
    const threshold = typeof expr.threshold === "number" ? expr.threshold : 1;

    if (ctx.latestRun.status === "PASSED") {
      return {
        shouldFire: false,
        shouldResolve: true,
        reason: "latest run passed",
      };
    }

    // Count consecutive non-PASSED runs ending at the most recent run.
    // The history list is ordered newest-first; the latest run may or
    // may not yet appear in it (it was just written by the runner), so
    // treat it as an additional +1 failure counted here.
    let streak = 1;
    for (const run of ctx.history) {
      if (run.id === ctx.latestRun.id) continue;
      if (run.status === "PASSED") break;
      streak++;
      if (streak > threshold) break;
    }

    if (streak >= threshold) {
      return {
        shouldFire: true,
        shouldResolve: false,
        reason: `${streak} consecutive non-passing runs (threshold=${threshold})`,
      };
    }
    return {
      shouldFire: false,
      shouldResolve: false,
      reason: `streak=${streak} below threshold=${threshold}`,
    };
  },
};
