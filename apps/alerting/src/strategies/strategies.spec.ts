import { describe, it, expect } from "vitest";
import { strategyFor } from "./index.js";
import type { AlertRule, CheckRun } from "@insightview/db";

function rule(
  strategy: "THRESHOLD" | "CONSECUTIVE_FAILURES" | "COMPOSITE",
  expression: Record<string, unknown>,
): AlertRule {
  return {
    id: "rule_1",
    tenantId: "default",
    name: "test-rule",
    checkId: "check_1",
    enabled: true,
    strategy,
    expression,
    severity: "WARNING",
    cooldownSeconds: 0,
    channelIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as AlertRule;
}

function run(status: "PASSED" | "FAILED" | "ERROR", id: string): CheckRun {
  return {
    id,
    tenantId: "default",
    checkId: "check_1",
    scheduledAt: new Date(),
    startedAt: new Date(),
    completedAt: new Date(),
    status,
    triggeredBy: "API",
    runnerId: "r",
    attempt: 1,
    errorMessage: null,
    createdAt: new Date(),
  } as unknown as CheckRun;
}

describe("ThresholdStrategy", () => {
  it("fires when the observed metric exceeds the threshold", () => {
    const s = strategyFor("THRESHOLD");
    const decision = s.evaluate({
      rule: rule("THRESHOLD", { metric: "LCP", operator: ">", value: 2500 }),
      latestRun: {
        id: "r1",
        status: "PASSED",
        durationMs: 1000,
        summary: {
          passedAssertions: 0,
          failedAssertions: 0,
          webVitals: { LCP: 3200 },
        },
        errorMessage: null,
      },
      history: [],
    });
    expect(decision.shouldFire).toBe(true);
    expect(decision.reason).toMatch(/LCP/);
  });

  it("does not fire when the observed metric is within bounds", () => {
    const s = strategyFor("THRESHOLD");
    const decision = s.evaluate({
      rule: rule("THRESHOLD", { metric: "LCP", operator: ">", value: 2500 }),
      latestRun: {
        id: "r1",
        status: "PASSED",
        durationMs: 1000,
        summary: { passedAssertions: 0, failedAssertions: 0, webVitals: { LCP: 1500 } },
        errorMessage: null,
      },
      history: [],
    });
    expect(decision.shouldFire).toBe(false);
    expect(decision.shouldResolve).toBe(true);
  });

  it("returns no-fire when the metric isn't reported", () => {
    const s = strategyFor("THRESHOLD");
    const decision = s.evaluate({
      rule: rule("THRESHOLD", { metric: "LCP", operator: ">", value: 2500 }),
      latestRun: {
        id: "r1",
        status: "PASSED",
        durationMs: 1000,
        summary: { passedAssertions: 0, failedAssertions: 0, webVitals: {} },
        errorMessage: null,
      },
      history: [],
    });
    expect(decision.shouldFire).toBe(false);
    expect(decision.reason).toMatch(/not reported/);
  });
});

describe("ConsecutiveFailuresStrategy", () => {
  it("fires on the first failure when threshold=1", () => {
    const s = strategyFor("CONSECUTIVE_FAILURES");
    const decision = s.evaluate({
      rule: rule("CONSECUTIVE_FAILURES", { threshold: 1 }),
      latestRun: {
        id: "r1",
        status: "FAILED",
        durationMs: 0,
        summary: { passedAssertions: 0, failedAssertions: 1, webVitals: {} },
        errorMessage: "assertion",
      },
      history: [],
    });
    expect(decision.shouldFire).toBe(true);
  });

  it("does not fire when the latest run passed", () => {
    const s = strategyFor("CONSECUTIVE_FAILURES");
    const decision = s.evaluate({
      rule: rule("CONSECUTIVE_FAILURES", { threshold: 1 }),
      latestRun: {
        id: "r1",
        status: "PASSED",
        durationMs: 0,
        summary: { passedAssertions: 1, failedAssertions: 0, webVitals: {} },
        errorMessage: null,
      },
      history: [run("FAILED", "r0")],
    });
    expect(decision.shouldFire).toBe(false);
    expect(decision.shouldResolve).toBe(true);
  });

  it("requires threshold=3 consecutive failures before firing", () => {
    const s = strategyFor("CONSECUTIVE_FAILURES");
    // Only 2 consecutive failures, threshold needs 3.
    const decision = s.evaluate({
      rule: rule("CONSECUTIVE_FAILURES", { threshold: 3 }),
      latestRun: {
        id: "r2",
        status: "FAILED",
        durationMs: 0,
        summary: { passedAssertions: 0, failedAssertions: 1, webVitals: {} },
        errorMessage: "x",
      },
      history: [run("FAILED", "r1"), run("PASSED", "r0")],
    });
    expect(decision.shouldFire).toBe(false);
  });
});

describe("CompositeStrategy", () => {
  it("AND: fires only when every sub-rule fires", () => {
    const s = strategyFor("COMPOSITE");
    const decision = s.evaluate({
      rule: rule("COMPOSITE", {
        all: [
          { strategy: "THRESHOLD", expression: { metric: "LCP", operator: ">", value: 2500 } },
          { strategy: "CONSECUTIVE_FAILURES", expression: { threshold: 1 } },
        ],
      }),
      latestRun: {
        id: "r1",
        status: "FAILED",
        durationMs: 1000,
        summary: { passedAssertions: 0, failedAssertions: 1, webVitals: { LCP: 3200 } },
        errorMessage: "x",
      },
      history: [],
    });
    expect(decision.shouldFire).toBe(true);
  });

  it("AND: does not fire when any sub-rule doesn't fire", () => {
    const s = strategyFor("COMPOSITE");
    const decision = s.evaluate({
      rule: rule("COMPOSITE", {
        all: [
          { strategy: "THRESHOLD", expression: { metric: "LCP", operator: ">", value: 2500 } },
          { strategy: "CONSECUTIVE_FAILURES", expression: { threshold: 3 } },
        ],
      }),
      latestRun: {
        id: "r1",
        status: "FAILED",
        durationMs: 1000,
        summary: { passedAssertions: 0, failedAssertions: 1, webVitals: { LCP: 3200 } },
        errorMessage: "x",
      },
      history: [],
    });
    expect(decision.shouldFire).toBe(false);
  });
});
