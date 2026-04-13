import { describe, it, expect } from "vitest";
import { strategyFor } from "./index.js";
import type { AlertRule, CheckRun } from "@insightview/db";

function rule(expr: Record<string, unknown>): AlertRule {
  return {
    id: "rule_1",
    tenantId: "default",
    name: "anomaly",
    checkId: "check_1",
    enabled: true,
    strategy: "ANOMALY_DETECTION",
    expression: expr,
    severity: "WARNING",
    cooldownSeconds: 0,
    channelIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as AlertRule;
}

function runRow(id: string, durationMs: number): CheckRun {
  return {
    id,
    tenantId: "default",
    checkId: "check_1",
    scheduledAt: new Date(),
    startedAt: new Date(),
    completedAt: new Date(),
    status: "PASSED",
    triggeredBy: "API",
    runnerId: "r",
    attempt: 1,
    errorMessage: null,
    createdAt: new Date(),
    durationMs,
  } as unknown as CheckRun;
}

describe("AnomalyDetectionStrategy", () => {
  const strategy = strategyFor("ANOMALY_DETECTION");

  it("does not fire when below the minimum sample count", () => {
    const decision = strategy.evaluate({
      rule: rule({ metric: "LCP", threshold: 3 }),
      latestRun: {
        id: "latest",
        status: "PASSED",
        durationMs: 1000,
        summary: {
          passedAssertions: 0,
          failedAssertions: 0,
          webVitals: { LCP: 5000 },
        },
        errorMessage: null,
      },
      history: [],
      historicalValues: { LCP: [1000, 1050] },
    });
    expect(decision.shouldFire).toBe(false);
    expect(decision.reason).toMatch(/need/);
  });

  it("fires when z-score exceeds threshold in the 'higher' direction", () => {
    const history = [1000, 1020, 990, 1010, 1005, 995, 1030, 1000, 1015, 985];
    const decision = strategy.evaluate({
      rule: rule({
        metric: "LCP",
        threshold: 3,
        minSamples: 5,
        direction: "higher",
      }),
      latestRun: {
        id: "latest",
        status: "PASSED",
        durationMs: 1000,
        summary: {
          passedAssertions: 0,
          failedAssertions: 0,
          webVitals: { LCP: 4500 }, // way above the mean ~1005
        },
        errorMessage: null,
      },
      history: history.map((_, i) => runRow(`r${i}`, 1000)),
      historicalValues: { LCP: history },
    });
    expect(decision.shouldFire).toBe(true);
    expect(decision.reason).toMatch(/z=/);
  });

  it("does not fire when the latest value is within bounds", () => {
    const history = [1000, 1020, 990, 1010, 1005, 995, 1030, 1000, 1015, 985];
    const decision = strategy.evaluate({
      rule: rule({
        metric: "LCP",
        threshold: 3,
        minSamples: 5,
      }),
      latestRun: {
        id: "latest",
        status: "PASSED",
        durationMs: 1000,
        summary: {
          passedAssertions: 0,
          failedAssertions: 0,
          webVitals: { LCP: 1015 },
        },
        errorMessage: null,
      },
      history: history.map((_, i) => runRow(`r${i}`, 1000)),
      historicalValues: { LCP: history },
    });
    expect(decision.shouldFire).toBe(false);
    expect(decision.shouldResolve).toBe(true);
  });

  it("fires on drops when direction=lower", () => {
    const history = [5000, 5100, 4900, 5050, 4950, 5000, 5100];
    const decision = strategy.evaluate({
      rule: rule({
        metric: "LCP",
        threshold: 3,
        minSamples: 5,
        direction: "lower",
      }),
      latestRun: {
        id: "latest",
        status: "PASSED",
        durationMs: 1000,
        summary: {
          passedAssertions: 0,
          failedAssertions: 0,
          webVitals: { LCP: 1000 },
        },
        errorMessage: null,
      },
      history: history.map((_, i) => runRow(`r${i}`, 1000)),
      historicalValues: { LCP: history },
    });
    expect(decision.shouldFire).toBe(true);
  });

  it("returns no-fire when history σ is zero", () => {
    const history = [1000, 1000, 1000, 1000, 1000, 1000];
    const decision = strategy.evaluate({
      rule: rule({ metric: "LCP", threshold: 3, minSamples: 5 }),
      latestRun: {
        id: "latest",
        status: "PASSED",
        durationMs: 1000,
        summary: {
          passedAssertions: 0,
          failedAssertions: 0,
          webVitals: { LCP: 2000 },
        },
        errorMessage: null,
      },
      history: history.map((_, i) => runRow(`r${i}`, 1000)),
      historicalValues: { LCP: history },
    });
    expect(decision.shouldFire).toBe(false);
    expect(decision.reason).toMatch(/σ=0/);
  });
});

describe("RumMetricStrategy", () => {
  const strategy = strategyFor("RUM_METRIC");
  const baseRule = (expr: Record<string, unknown>) =>
    ({
      ...rule(expr),
      strategy: "RUM_METRIC",
    }) as AlertRule;

  it("does not fire below minimum sample count", () => {
    const decision = strategy.evaluate({
      rule: baseRule({
        metric: "LCP",
        percentile: "p75",
        operator: ">",
        value: 2500,
        minSampleCount: 100,
      }),
      latestRun: {
        id: "latest",
        status: "PASSED",
        durationMs: 1000,
        summary: { passedAssertions: 0, failedAssertions: 0, webVitals: {} },
        errorMessage: null,
      },
      history: [],
      rumAggregates: {
        LCP: { p50: 2000, p75: 3000, p95: 4000, count: 30, mean: 2200 },
      },
    });
    expect(decision.shouldFire).toBe(false);
  });

  it("fires when p75 exceeds threshold with enough samples", () => {
    const decision = strategy.evaluate({
      rule: baseRule({
        metric: "LCP",
        percentile: "p75",
        operator: ">",
        value: 2500,
        minSampleCount: 20,
      }),
      latestRun: {
        id: "latest",
        status: "PASSED",
        durationMs: 1000,
        summary: { passedAssertions: 0, failedAssertions: 0, webVitals: {} },
        errorMessage: null,
      },
      history: [],
      rumAggregates: {
        LCP: { p50: 2000, p75: 3000, p95: 4000, count: 200, mean: 2200 },
      },
    });
    expect(decision.shouldFire).toBe(true);
  });

  it("does not fire when RUM aggregate is missing", () => {
    const decision = strategy.evaluate({
      rule: baseRule({ metric: "LCP", percentile: "p75", operator: ">", value: 2500 }),
      latestRun: {
        id: "latest",
        status: "PASSED",
        durationMs: 1000,
        summary: { passedAssertions: 0, failedAssertions: 0, webVitals: {} },
        errorMessage: null,
      },
      history: [],
    });
    expect(decision.shouldFire).toBe(false);
    expect(decision.reason).toMatch(/no RUM aggregate/);
  });
});
