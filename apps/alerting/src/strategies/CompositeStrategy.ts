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
    const hasAll =
      Array.isArray(expr.all) && expr.all.length > 0;
    const hasAny =
      Array.isArray(expr.any) && expr.any.length > 0;

    // Enforce the contract documented above: exactly one of `all` or
    // `any` must be present. Silently picking one when both are set
    // would produce surprising alert behavior; rejecting both-empty
    // prevents a misconfigured rule from firing forever.
    if (hasAll && hasAny) {
      return {
        shouldFire: false,
        shouldResolve: false,
        reason:
          "composite expression has both `all` and `any`; exactly one must be present",
      };
    }
    if (!hasAll && !hasAny) {
      return {
        shouldFire: false,
        shouldResolve: false,
        reason:
          "composite expression has neither `all` nor `any`; exactly one must be present",
      };
    }

    if (hasAll) {
      const results = expr.all!.map((sub) => evalSub(ctx, sub));
      const allFire = results.every((r) => r.shouldFire);
      return {
        shouldFire: allFire,
        shouldResolve: !allFire,
        reason: `composite all: ${results.map((r) => r.reason).join("; ")}`,
      };
    }
    const results = expr.any!.map((sub) => evalSub(ctx, sub));
    const anyFire = results.some((r) => r.shouldFire);
    return {
      shouldFire: anyFire,
      shouldResolve: !anyFire,
      reason: `composite any: ${results.map((r) => r.reason).join("; ")}`,
    };
  },
};
