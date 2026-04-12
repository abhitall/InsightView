import type { Strategy, EvaluationContext, Decision } from "./index.js";
import { thresholdStrategy } from "./ThresholdStrategy.js";
import { consecutiveFailuresStrategy } from "./ConsecutiveFailuresStrategy.js";

/**
 * COMPOSITE strategy. Expression shape:
 *   { all?: SubRule[]; any?: SubRule[] }
 *
 * A SubRule is `{ strategy: "THRESHOLD" | "CONSECUTIVE_FAILURES", expression: {...} }`.
 * `all` is AND, `any` is OR. Exactly one of them must be present.
 */
interface SubRule {
  strategy: "THRESHOLD" | "CONSECUTIVE_FAILURES";
  expression: Record<string, unknown>;
}

function evalSub(ctx: EvaluationContext, sub: SubRule): Decision {
  const fakeCtx: EvaluationContext = {
    ...ctx,
    rule: { ...ctx.rule, strategy: sub.strategy, expression: sub.expression } as typeof ctx.rule,
  };
  if (sub.strategy === "THRESHOLD") return thresholdStrategy.evaluate(fakeCtx);
  return consecutiveFailuresStrategy.evaluate(fakeCtx);
}

export const compositeStrategy: Strategy = {
  evaluate(ctx) {
    const expr = (ctx.rule.expression ?? {}) as {
      all?: SubRule[];
      any?: SubRule[];
    };

    if (expr.all && Array.isArray(expr.all) && expr.all.length > 0) {
      const results = expr.all.map((sub) => evalSub(ctx, sub));
      const allFire = results.every((r) => r.shouldFire);
      return {
        shouldFire: allFire,
        shouldResolve: !allFire,
        reason: `composite all: ${results.map((r) => r.reason).join("; ")}`,
      };
    }
    if (expr.any && Array.isArray(expr.any) && expr.any.length > 0) {
      const results = expr.any.map((sub) => evalSub(ctx, sub));
      const anyFire = results.some((r) => r.shouldFire);
      return {
        shouldFire: anyFire,
        shouldResolve: !anyFire,
        reason: `composite any: ${results.map((r) => r.reason).join("; ")}`,
      };
    }
    return {
      shouldFire: false,
      shouldResolve: false,
      reason: "composite has neither all nor any",
    };
  },
};
