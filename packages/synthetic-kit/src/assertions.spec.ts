import { describe, it, expect } from "vitest";
import { runAssertions } from "./assertions.js";

const ctx = {
  statusCode: 200,
  bodyHtml: "<html><title>Example</title>Hello world</html>",
  title: "Example Home",
  durationMs: 450,
  webVitals: { LCP: 1800, CLS: 0.05, INP: 120 },
};

describe("assertions.runAssertions", () => {
  it("passes a status=passed assertion on a 200 response", () => {
    const out = runAssertions([{ type: "status", value: "passed" }], ctx);
    expect(out.passed).toBe(1);
    expect(out.failed).toBe(0);
  });

  it("fails a status=passed assertion on a 500 response", () => {
    const out = runAssertions(
      [{ type: "status", value: "passed" }],
      { ...ctx, statusCode: 500 },
    );
    expect(out.passed).toBe(0);
    expect(out.failed).toBe(1);
    expect(out.failureReasons[0]).toMatch(/code=500/);
  });

  it("body-contains match", () => {
    const out = runAssertions(
      [{ type: "body-contains", value: "Hello" }],
      ctx,
    );
    expect(out.passed).toBe(1);
  });

  it("body-contains mismatch", () => {
    const out = runAssertions(
      [{ type: "body-contains", value: "Goodbye" }],
      ctx,
    );
    expect(out.failed).toBe(1);
    expect(out.failureReasons[0]).toMatch(/does not contain/);
  });

  it("max-lcp-ms passes when LCP is under budget", () => {
    const out = runAssertions(
      [{ type: "max-lcp-ms", value: "2500" }],
      ctx,
    );
    expect(out.passed).toBe(1);
  });

  it("max-lcp-ms fails when LCP is over budget", () => {
    const out = runAssertions(
      [{ type: "max-lcp-ms", value: "1000" }],
      ctx,
    );
    expect(out.failed).toBe(1);
    expect(out.failureReasons[0]).toMatch(/LCP/);
  });

  it("max-lcp-ms skips (passes) when LCP is not collected", () => {
    const out = runAssertions(
      [{ type: "max-lcp-ms", value: "1000" }],
      { ...ctx, webVitals: {} },
    );
    expect(out.passed).toBe(1);
    expect(out.results[0].detail).toMatch(/skipped/);
  });

  it("max-cls passes when CLS is within budget", () => {
    const out = runAssertions(
      [{ type: "max-cls", value: "0.1" }],
      ctx,
    );
    expect(out.passed).toBe(1);
  });

  it("unknown assertion type is reported as failure", () => {
    const out = runAssertions(
      [{ type: "unknown-type", value: "nope" }],
      ctx,
    );
    expect(out.failed).toBe(1);
    expect(out.failureReasons[0]).toMatch(/unknown/);
  });

  it("aggregates multiple assertion outcomes", () => {
    const out = runAssertions(
      [
        { type: "status", value: "passed" },
        { type: "body-contains", value: "nope" },
        { type: "max-duration-ms", value: "1000" },
      ],
      ctx,
    );
    expect(out.passed).toBe(2);
    expect(out.failed).toBe(1);
  });
});
