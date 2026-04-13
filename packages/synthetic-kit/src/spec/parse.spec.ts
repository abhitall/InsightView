import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMonitorPath } from "./parse.js";

function writeSpec(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "insightview-spec-"));
  const file = join(dir, "monitor.yaml");
  writeFileSync(file, content);
  return file;
}

describe("spec.parseMonitorPath", () => {
  it("parses a minimal Check doc with default steps", () => {
    const file = writeSpec(`
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: smoke
spec:
  type: browser
  targetUrl: "https://example.com/"
`);
    const specs = parseMonitorPath(file);
    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe("smoke");
    expect(specs[0].steps).toHaveLength(1);
    expect(specs[0].steps?.[0].url).toBe("https://example.com/");
  });

  it("parses native.auth + network + exporters", () => {
    const file = writeSpec(`
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: authed
spec:
  type: browser
  targetUrl: "https://app.example.com/dashboard"
  native:
    auth:
      strategy: form-login
      config:
        loginUrl: https://app.example.com/login
    network:
      profile: tailscale
    exporters:
      - type: stdout
      - type: healthchecks
        config:
          url: https://hc-ping.com/xyz
    preCookies:
      - name: consent
        value: "1"
`);
    const [spec] = parseMonitorPath(file);
    expect(spec.auth?.strategy).toBe("form-login");
    expect(spec.network?.profile).toBe("tailscale");
    expect(spec.exporters).toHaveLength(2);
    expect(spec.preCookies).toHaveLength(1);
  });

  it("rejects an invalid auth strategy", () => {
    const file = writeSpec(`
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: bad
spec:
  type: browser
  targetUrl: "https://example.com/"
  native:
    auth:
      strategy: unsupported-scheme
`);
    expect(() => parseMonitorPath(file)).toThrow(/schema error/);
  });

  it("ignores AlertRule documents in the same file", () => {
    const file = writeSpec(`
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: only-check
spec:
  type: browser
  targetUrl: "https://example.com/"
---
apiVersion: insightview.io/v1
kind: AlertRule
metadata:
  name: the-rule
spec:
  strategy: THRESHOLD
  expression: { metric: duration, operator: ">", value: 5000 }
  severity: WARNING
`);
    const specs = parseMonitorPath(file);
    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe("only-check");
  });
});
