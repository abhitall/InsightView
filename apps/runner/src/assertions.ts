export interface AssertionInput {
  type: string;
  value: string;
}

export interface AssertionContext {
  responseStatus: number;
  bodyHtml: string;
  durationMs: number;
}

export interface AssertionResult {
  passed: number;
  failed: number;
  failureReasons: string[];
}

/**
 * Evaluate the assertions declared on the Check against the actual
 * response/page state. Adding new assertion kinds is a one-case addition
 * here; the strategy lives at the Check schema layer.
 */
export function runAssertions(
  assertions: AssertionInput[],
  ctx: AssertionContext,
): AssertionResult {
  let passed = 0;
  let failed = 0;
  const failureReasons: string[] = [];

  for (const assertion of assertions) {
    try {
      switch (assertion.type) {
        case "status": {
          const expected = assertion.value.toLowerCase();
          const actual = ctx.responseStatus >= 200 && ctx.responseStatus < 400 ? "passed" : "failed";
          if (expected === "passed" && actual === "passed") passed++;
          else if (expected === "failed" && actual === "failed") passed++;
          else {
            failed++;
            failureReasons.push(
              `status expected=${expected} actual=${actual} code=${ctx.responseStatus}`,
            );
          }
          break;
        }
        case "body-contains": {
          if (ctx.bodyHtml.includes(assertion.value)) {
            passed++;
          } else {
            failed++;
            failureReasons.push(`body does not contain '${assertion.value}'`);
          }
          break;
        }
        case "title-contains": {
          const match = ctx.bodyHtml.match(/<title>([^<]*)<\/title>/i);
          const title = match?.[1] ?? "";
          if (title.includes(assertion.value)) {
            passed++;
          } else {
            failed++;
            failureReasons.push(`title '${title}' does not contain '${assertion.value}'`);
          }
          break;
        }
        case "max-duration-ms": {
          const budget = parseInt(assertion.value, 10);
          if (Number.isFinite(budget) && ctx.durationMs <= budget) {
            passed++;
          } else {
            failed++;
            failureReasons.push(
              `duration ${ctx.durationMs}ms > budget ${budget}ms`,
            );
          }
          break;
        }
        default:
          failed++;
          failureReasons.push(`unknown assertion type '${assertion.type}'`);
      }
    } catch (err) {
      failed++;
      failureReasons.push(`assertion crashed: ${(err as Error).message}`);
    }
  }

  return { passed, failed, failureReasons };
}
