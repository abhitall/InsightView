import type { AlertRule, CheckRun } from "@insightview/db";
import type { AlertStrategy, CheckRunStatus } from "@insightview/core";
import { ValidationError } from "@insightview/core";
import { thresholdStrategy } from "./ThresholdStrategy.js";
import { consecutiveFailuresStrategy } from "./ConsecutiveFailuresStrategy.js";
import { compositeStrategy } from "./CompositeStrategy.js";
import { anomalyDetectionStrategy } from "./AnomalyDetectionStrategy.js";
import { rumMetricStrategy } from "./RumMetricStrategy.js";

export interface LatestRunFacts {
  id: string;
  status: CheckRunStatus;
  durationMs: number;
  summary: {
    passedAssertions: number;
    failedAssertions: number;
    webVitals: Record<string, number>;
  };
  errorMessage: string | null;
}

export interface EvaluationContext {
  rule: AlertRule;
  latestRun: LatestRunFacts;
  history: CheckRun[];
  /**
   * Pre-populated historical metric samples for anomaly detection.
   * The evaluator builds this by joining the history CheckRuns against
   * their associated CheckResults and projecting web-vital names.
   * The anomaly strategy reads this instead of walking the DB itself.
   */
  historicalValues?: Record<string, number[]>;
  /**
   * For RUM_METRIC strategy: pre-fetched aggregates over a time
   * window. Key is the metric name, value is p50/p75/p95/count.
   */
  rumAggregates?: Record<
    string,
    { p50: number; p75: number; p95: number; count: number; mean: number }
  >;
}

export interface Decision {
  shouldFire: boolean;
  shouldResolve: boolean;
  reason: string;
}

export interface Strategy {
  evaluate(ctx: EvaluationContext): Decision;
}

/**
 * Strategy registry. Adding a new evaluator is one entry below.
 */
const registry: Record<AlertStrategy, Strategy> = {
  THRESHOLD: thresholdStrategy,
  CONSECUTIVE_FAILURES: consecutiveFailuresStrategy,
  COMPOSITE: compositeStrategy,
  ANOMALY_DETECTION: anomalyDetectionStrategy,
  RUM_METRIC: rumMetricStrategy,
};

export function strategyFor(name: AlertStrategy): Strategy {
  const s = registry[name];
  if (!s) throw new ValidationError(`Unknown alert strategy '${name}'`);
  return s;
}
