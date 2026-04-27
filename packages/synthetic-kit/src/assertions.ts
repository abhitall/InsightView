import type { AssertionResult, WebVitals } from "./types.js";

/**
 * Assertion evaluator. Takes a list of declarative assertions plus
 * the facts observed during a step, and returns the per-assertion
 * outcome plus a list of human-readable failure reasons.
 *
 * Supported assertion types:
 *
 *   { type: "status", value: "passed" | "failed" }
 *       response code classified as 2xx/3xx -> "passed", else "failed"
 *
 *   { type: "status-code", value: "200" }
 *       exact status code match
 *
 *   { type: "body-contains", value: "Welcome" }
 *       bodyHtml.includes(value)
 *
 *   { type: "title-contains", value: "Home" }
 *       page.title().includes(value)
 *
 *   { type: "max-duration-ms", value: "3000" }
 *       step duration <= value
 *
 *   { type: "max-lcp-ms", value: "2500" }
 *       web vitals LCP <= value (good threshold)
 *
 *   { type: "max-cls", value: "0.1" }
 *       web vitals CLS <= value
 */

export interface AssertionContext {
  statusCode: number;
  bodyHtml: string;
  title: string;
  durationMs: number;
  webVitals: WebVitals;
}

export interface AssertionOutcome {
  results: AssertionResult[];
  passed: number;
  failed: number;
  failureReasons: string[];
}

export function runAssertions(
  assertions: Array<{ type: string; value: string }>,
  ctx: AssertionContext,
): AssertionOutcome {
  const results: AssertionResult[] = [];
  const reasons: string[] = [];
  let passed = 0;
  let failed = 0;

  for (const a of assertions) {
    const outcome = evaluate(a, ctx);
    results.push(outcome);
    if (outcome.passed) {
      passed++;
    } else {
      failed++;
      reasons.push(outcome.detail ?? `${a.type} failed`);
    }
  }

  return { results, passed, failed, failureReasons: reasons };
}

function evaluate(
  a: { type: string; value: string },
  ctx: AssertionContext,
): AssertionResult {
  switch (a.type) {
    case "status": {
      const expected = a.value.toLowerCase();
      const actual = ctx.statusCode >= 200 && ctx.statusCode < 400 ? "passed" : "failed";
      const passed = expected === actual;
      return {
        type: a.type,
        value: a.value,
        passed,
        detail: passed
          ? undefined
          : `status expected=${expected} actual=${actual} code=${ctx.statusCode}`,
      };
    }
    case "status-code": {
      const expected = parseInt(a.value, 10);
      const passed = ctx.statusCode === expected;
      return {
        type: a.type,
        value: a.value,
        passed,
        detail: passed ? undefined : `expected status code ${expected}, got ${ctx.statusCode}`,
      };
    }
    case "body-contains": {
      const passed = ctx.bodyHtml.includes(a.value);
      return {
        type: a.type,
        value: a.value,
        passed,
        detail: passed ? undefined : `body does not contain '${a.value}'`,
      };
    }
    case "title-contains": {
      const passed = ctx.title.includes(a.value);
      return {
        type: a.type,
        value: a.value,
        passed,
        detail: passed ? undefined : `title '${ctx.title}' does not contain '${a.value}'`,
      };
    }
    case "max-duration-ms": {
      const budget = parseFloat(a.value);
      const passed = Number.isFinite(budget) && ctx.durationMs <= budget;
      return {
        type: a.type,
        value: a.value,
        passed,
        detail: passed
          ? undefined
          : `duration ${ctx.durationMs}ms > budget ${budget}ms`,
      };
    }
    case "max-lcp-ms": {
      const budget = parseFloat(a.value);
      const observed = ctx.webVitals.LCP;
      if (typeof observed !== "number") {
        // LCP not captured — don't fail on it (partial collection is
        // reported separately).
        return {
          type: a.type,
          value: a.value,
          passed: true,
          detail: "LCP not collected; assertion skipped",
        };
      }
      const passed = observed <= budget;
      return {
        type: a.type,
        value: a.value,
        passed,
        detail: passed
          ? undefined
          : `LCP ${observed.toFixed(0)}ms > budget ${budget}ms`,
      };
    }
    case "max-cls": {
      const budget = parseFloat(a.value);
      const observed = ctx.webVitals.CLS;
      if (typeof observed !== "number") {
        return {
          type: a.type,
          value: a.value,
          passed: true,
          detail: "CLS not collected; assertion skipped",
        };
      }
      const passed = observed <= budget;
      return {
        type: a.type,
        value: a.value,
        passed,
        detail: passed
          ? undefined
          : `CLS ${observed.toFixed(3)} > budget ${budget}`,
      };
    }
    default:
      return {
        type: a.type,
        value: a.value,
        passed: false,
        detail: `unknown assertion type '${a.type}'`,
      };
  }
}
