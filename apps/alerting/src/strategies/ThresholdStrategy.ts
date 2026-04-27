import type { Strategy } from "./index.js";

/**
 * THRESHOLD strategy. Expression shape:
 *   { metric: "duration" | "LCP" | "CLS" | ..., operator: ">" | "<", value: number }
 *
 * Example: { metric: "LCP", operator: ">", value: 2500 } fires when the
 * latest run reports an LCP above 2.5 seconds.
 */
export const thresholdStrategy: Strategy = {
  evaluate(ctx) {
    const expr = (ctx.rule.expression ?? {}) as {
      metric?: string;
      operator?: string;
      value?: number;
    };
    const metric = expr.metric;
    const op = expr.operator ?? ">";
    const threshold = typeof expr.value === "number" ? expr.value : NaN;
    if (!metric || Number.isNaN(threshold)) {
      return { shouldFire: false, shouldResolve: false, reason: "invalid expression" };
    }

    const observed =
      metric === "duration"
        ? ctx.latestRun.durationMs
        : ctx.latestRun.summary.webVitals[metric];
    if (typeof observed !== "number") {
      return { shouldFire: false, shouldResolve: false, reason: `metric '${metric}' not reported` };
    }

    const breached =
      (op === ">" && observed > threshold) ||
      (op === ">=" && observed >= threshold) ||
      (op === "<" && observed < threshold) ||
      (op === "<=" && observed <= threshold) ||
      (op === "==" && observed === threshold);

    if (breached) {
      return {
        shouldFire: true,
        shouldResolve: false,
        reason: `${metric} ${op} ${threshold} (observed=${observed})`,
      };
    }
    return {
      shouldFire: false,
      shouldResolve: true,
      reason: `${metric}=${observed} within bounds`,
    };
  },
};
