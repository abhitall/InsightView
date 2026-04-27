import { describe, it, expect } from "vitest";
import { classifyError, isTransientError, isInfraError } from "./errors.js";
import { ErrorCategory } from "./types.js";

describe("errors.classifyError", () => {
  it("classifies DNS resolution failures as TARGET_DOWN", () => {
    const err = new Error("getaddrinfo ENOTFOUND host.example");
    const out = classifyError(err);
    expect(out.category).toBe(ErrorCategory.TARGET_DOWN);
    expect(out.transient).toBe(true);
  });

  it("classifies connection resets as TARGET_DOWN", () => {
    const err = new Error("socket hang up");
    expect(classifyError(err).category).toBe(ErrorCategory.TARGET_DOWN);
  });

  it("classifies Playwright browser launch failures as INFRA_FAILURE", () => {
    const err = new Error("browserType.launch: Executable doesn't exist");
    const out = classifyError(err);
    expect(out.category).toBe(ErrorCategory.INFRA_FAILURE);
    expect(out.transient).toBe(true);
  });

  it("classifies page-closed mid-evaluate as INFRA_FAILURE", () => {
    const err = new Error("page.evaluate: Target closed");
    expect(classifyError(err).category).toBe(ErrorCategory.INFRA_FAILURE);
  });

  it("classifies generic assertion errors as TARGET_ERROR (non-transient)", () => {
    const err = new Error("Expected title 'Home' but got 'Login'");
    const out = classifyError(err);
    expect(out.category).toBe(ErrorCategory.TARGET_ERROR);
    expect(out.transient).toBe(false);
  });

  it("isTransientError recognises net::err_* patterns", () => {
    expect(
      isTransientError(new Error("net::ERR_CONNECTION_REFUSED")),
    ).toBe(true);
  });

  it("isInfraError recognises spawn ENOENT", () => {
    expect(isInfraError(new Error("spawn playwright ENOENT"))).toBe(true);
  });
});
