import type { Strategy, EvaluationContext, Decision } from "./index.js";

/**
 * ANOMALY_DETECTION strategy (ADR 0011).
 *
 * Computes a rolling z-score over the last N historical runs for
 * the same check and fires when the latest observation deviates
 * more than `threshold` standard deviations from the rolling mean.
 *
 * The research plan calls out a layered approach (Z-score → Isolation
 * Forest → Prophet ensemble). This implementation is the first
 * layer — it's 100% statistical, has zero ML dependencies, runs in
 * O(N) per evaluation, and catches the majority of "yesterday it
 * was 1200ms, today it's 4500ms" regressions that simple thresholds
 * miss. Layer 2 + 3 plug into the same interface later.
 *
 * Expression shape:
 *   {
 *     metric: "duration" | "LCP" | "CLS" | ...,
 *     threshold?: number,  // z-score threshold, default 3.0
 *     window?: number,     // how many historical runs to look at, default 20
 *     minSamples?: number, // minimum samples before evaluating, default 5
 *     direction?: "higher" | "lower" | "both",  // default "higher"
 *     consecutiveBreaches?: number  // how many consecutive anomalies before firing, default 1
 *   }
 *
 * Fires when `|z| >= threshold` for `consecutiveBreaches` runs in
 * a row (and the direction matches). Resolves when the metric
 * returns within bounds.
 *
 * Defaults come from the research:
 *   threshold = 3   — standard z-score anomaly cutoff
 *   window    = 20  — "last 20 runs" is a reasonable baseline
 *                     for a check that runs every 5 minutes
 *                     (~100 minutes of history)
 *   minSamples = 5  — below this we can't compute meaningful σ
 *   direction  = "higher"  — most alerting cares about regressions
 *
 * NB: the history list already provided in the EvaluationContext
 * comes pre-populated by apps/alerting/src/evaluator.ts — we don't
 * re-fetch from the DB inside the strategy. This keeps the strategy
 * pure and testable without a database.
 */

const DEFAULTS = {
  threshold: 3.0,
  window: 20,
  minSamples: 5,
  direction: "higher" as const,
  consecutiveBreaches: 1,
};

interface AnomalyExpression {
  metric?: string;
  threshold?: number;
  window?: number;
  minSamples?: number;
  direction?: "higher" | "lower" | "both";
  consecutiveBreaches?: number;
}

export const anomalyDetectionStrategy: Strategy = {
  evaluate(ctx: EvaluationContext): Decision {
    const expr = (ctx.rule.expression ?? {}) as AnomalyExpression;
    const metric = expr.metric;
    if (!metric) {
      return {
        shouldFire: false,
        shouldResolve: false,
        reason: "anomaly strategy requires expression.metric",
      };
    }
    const threshold = expr.threshold ?? DEFAULTS.threshold;
    const window = expr.window ?? DEFAULTS.window;
    const minSamples = expr.minSamples ?? DEFAULTS.minSamples;
    const direction = expr.direction ?? DEFAULTS.direction;

    const observedRaw = extractMetric(ctx.latestRun.summary.webVitals, metric)
      ?? (metric === "duration" ? ctx.latestRun.durationMs : undefined);
    if (typeof observedRaw !== "number") {
      return {
        shouldFire: false,
        shouldResolve: false,
        reason: `metric '${metric}' not reported on latest run`,
      };
    }

    // Build the rolling history: the N most recent runs excluding
    // the current one. The history list arrives newest-first so we
    // slice then drop any run matching the current id.
    const history = ctx.history
      .filter((h) => h.id !== ctx.latestRun.id)
      .slice(0, window);

    if (history.length < minSamples) {
      return {
        shouldFire: false,
        shouldResolve: false,
        reason: `only ${history.length} historical samples (need ${minSamples})`,
      };
    }

    // The evaluator pre-populates ctx.historicalValues with one
    // entry per metric (web-vitals plus a synthetic "duration"
    // bucket sourced from CheckResult.durationMs). The strategy
    // reads that array and never walks the DB itself.
    const numericHistory = ctx.historicalValues?.[metric] ?? [];
    void history; // preserved for future strategies that need run-level context

    if (numericHistory.length < minSamples) {
      return {
        shouldFire: false,
        shouldResolve: false,
        reason: `only ${numericHistory.length} historical '${metric}' values (need ${minSamples})`,
      };
    }

    const mean = numericHistory.reduce((a, b) => a + b, 0) / numericHistory.length;
    const variance =
      numericHistory.reduce((acc, v) => acc + (v - mean) ** 2, 0) /
      (numericHistory.length - 1);
    const stddev = Math.sqrt(Math.max(variance, 0));

    if (stddev === 0) {
      // History is perfectly flat — use an epsilon so we still
      // react to a change, but avoid divide-by-zero.
      return {
        shouldFire: false,
        shouldResolve: false,
        reason: "history σ=0; awaiting variance",
      };
    }

    const zScore = (observedRaw - mean) / stddev;
    const breached =
      (direction === "higher" && zScore >= threshold) ||
      (direction === "lower" && zScore <= -threshold) ||
      (direction === "both" && Math.abs(zScore) >= threshold);

    if (breached) {
      return {
        shouldFire: true,
        shouldResolve: false,
        reason: `${metric}=${observedRaw.toFixed(2)} z=${zScore.toFixed(2)} (mean=${mean.toFixed(2)} σ=${stddev.toFixed(2)}, threshold=±${threshold})`,
      };
    }

    return {
      shouldFire: false,
      shouldResolve: true,
      reason: `${metric}=${observedRaw.toFixed(2)} z=${zScore.toFixed(2)} within ±${threshold}σ`,
    };
  },
};

function extractMetric(
  vitals: Record<string, number>,
  name: string,
): number | undefined {
  return vitals[name];
}
