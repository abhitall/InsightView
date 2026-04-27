import type { Strategy, EvaluationContext, Decision } from "./index.js";

/**
 * RUM_METRIC strategy. Fires based on aggregated real-user data
 * (not the current synthetic run) so you can alert on "my RUM
 * p75 LCP crossed 2500ms over the last 15 minutes across more
 * than 100 sessions". The raw rum_events rollup is computed by
 * the evaluator before `evaluate` is called, then passed in via
 * ctx.rumAggregates.
 *
 * Expression shape:
 *   {
 *     metric: "LCP" | "CLS" | "INP" | ...,
 *     percentile: "p50" | "p75" | "p95" | "mean",
 *     operator: ">" | ">=" | "<" | "<=",
 *     value: number,              // threshold
 *     minSampleCount?: number,    // ignore when sample is thin
 *   }
 */
interface RumExpression {
  metric?: string;
  percentile?: "p50" | "p75" | "p95" | "mean";
  operator?: ">" | ">=" | "<" | "<=";
  value?: number;
  minSampleCount?: number;
}

export const rumMetricStrategy: Strategy = {
  evaluate(ctx: EvaluationContext): Decision {
    const expr = (ctx.rule.expression ?? {}) as RumExpression;
    const metric = expr.metric;
    const percentile = expr.percentile ?? "p75";
    const operator = expr.operator ?? ">";
    const threshold =
      typeof expr.value === "number" ? expr.value : Number.NaN;
    const minSampleCount = expr.minSampleCount ?? 50;

    if (!metric || Number.isNaN(threshold)) {
      return {
        shouldFire: false,
        shouldResolve: false,
        reason: "rum-metric strategy requires metric + value",
      };
    }

    const agg = ctx.rumAggregates?.[metric];
    if (!agg) {
      return {
        shouldFire: false,
        shouldResolve: false,
        reason: `no RUM aggregate available for '${metric}' — is the evaluator populated?`,
      };
    }
    if (agg.count < minSampleCount) {
      return {
        shouldFire: false,
        shouldResolve: false,
        reason: `only ${agg.count} samples (need ${minSampleCount})`,
      };
    }

    const observed = agg[percentile];
    const breached =
      (operator === ">" && observed > threshold) ||
      (operator === ">=" && observed >= threshold) ||
      (operator === "<" && observed < threshold) ||
      (operator === "<=" && observed <= threshold);

    if (breached) {
      return {
        shouldFire: true,
        shouldResolve: false,
        reason: `RUM ${metric} ${percentile}=${observed.toFixed(2)} ${operator} ${threshold} (n=${agg.count})`,
      };
    }

    return {
      shouldFire: false,
      shouldResolve: true,
      reason: `RUM ${metric} ${percentile}=${observed.toFixed(2)} within bounds`,
    };
  },
};
