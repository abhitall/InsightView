import type { AlertRule, CheckRun } from "@insightview/db";
import type { AlertStrategy, CheckRunStatus } from "@insightview/core";
import { ValidationError } from "@insightview/core";
import { thresholdStrategy } from "./ThresholdStrategy.js";
import { consecutiveFailuresStrategy } from "./ConsecutiveFailuresStrategy.js";
import { compositeStrategy } from "./CompositeStrategy.js";

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
 * Strategy registry. New evaluation strategies plug in via a single
 * map entry — this is the central affordance for future ML / anomaly
 * detection work described in docs/ROADMAP.md.
 */
const registry: Record<AlertStrategy, Strategy> = {
  THRESHOLD: thresholdStrategy,
  CONSECUTIVE_FAILURES: consecutiveFailuresStrategy,
  COMPOSITE: compositeStrategy,
};

export function strategyFor(name: AlertStrategy): Strategy {
  const s = registry[name];
  if (!s) throw new ValidationError(`Unknown alert strategy '${name}'`);
  return s;
}
