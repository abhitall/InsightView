import { describe, it, expect } from "vitest";
import { parseMonitorsYaml } from "./monitorsYaml.js";

describe("monitorsYaml.parseMonitorsYaml", () => {
  it("parses a single Check doc", () => {
    const yaml = `
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: homepage
  description: "Homepage monitor"
  tags: [smoke]
spec:
  type: browser
  schedule: "*/5 * * * *"
  targetUrl: https://example.com/
  assertions:
    - { type: status, value: passed }
`;
    const docs = parseMonitorsYaml(yaml);
    expect(docs).toHaveLength(1);
    expect(docs[0].kind).toBe("Check");
    expect(docs[0].metadata.name).toBe("homepage");
  });

  it("parses multiple docs separated by ---", () => {
    const yaml = `
apiVersion: insightview.io/v1
kind: Check
metadata: { name: homepage }
spec:
  schedule: "*/5 * * * *"
  targetUrl: https://example.com/
---
apiVersion: insightview.io/v1
kind: AlertRule
metadata: { name: homepage-down }
spec:
  checkName: homepage
  strategy: CONSECUTIVE_FAILURES
  expression: { threshold: 2 }
  severity: CRITICAL
`;
    const docs = parseMonitorsYaml(yaml);
    expect(docs).toHaveLength(2);
    expect(docs[0].kind).toBe("Check");
    expect(docs[1].kind).toBe("AlertRule");
  });

  it("throws ValidationError on malformed YAML", () => {
    expect(() => parseMonitorsYaml("this: is: not: valid")).toThrow();
  });

  it("throws ValidationError on missing required fields", () => {
    const yaml = `
apiVersion: insightview.io/v1
kind: Check
metadata: { name: homepage }
spec:
  schedule: "*/5 * * * *"
`;
    expect(() => parseMonitorsYaml(yaml)).toThrow(/schema/);
  });
});
