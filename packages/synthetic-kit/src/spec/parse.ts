import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import type { MonitorSpec, MonitorStep } from "../types.js";
import { MonitorDocSchema, type MonitorDoc } from "./schema.js";

/**
 * Parse a directory or single YAML file into a list of MonitorSpec
 * objects ready for the runCheck orchestrator. AlertRule documents
 * are silently ignored (they're a platform-mode concern).
 */
export function parseMonitorPath(pathOrDir: string): MonitorSpec[] {
  const stat = statSync(pathOrDir);
  const files = stat.isDirectory() ? walkYaml(pathOrDir) : [pathOrDir];
  const specs: MonitorSpec[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const docs = parseAllDocuments(content);
    for (const doc of docs) {
      if (doc.errors.length > 0) {
        throw new Error(
          `YAML parse error in ${file}: ${doc.errors
            .map((e) => e.message)
            .join("; ")}`,
        );
      }
      const json = doc.toJS();
      if (!json) continue;
      if (json.kind !== "Check") continue; // skip AlertRule etc.
      const parsed = MonitorDocSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          `Monitor schema error in ${file}: ${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }
      specs.push(docToSpec(parsed.data));
    }
  }
  return specs;
}

function walkYaml(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkYaml(full));
    } else if (/\.(ya?ml)$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function docToSpec(doc: MonitorDoc): MonitorSpec {
  const native = doc.spec.native;
  const steps: MonitorStep[] = doc.spec.steps
    ? (doc.spec.steps as MonitorStep[])
    : [
        {
          name: "navigate",
          url: doc.spec.targetUrl,
          waitFor: { networkIdle: false },
        },
      ];
  return {
    name: doc.metadata.name,
    description: doc.metadata.description,
    targetUrl: doc.spec.targetUrl,
    timeoutMs: doc.spec.timeoutMs,
    retries: doc.spec.retries,
    scriptRef: doc.spec.scriptRef,
    assertions: doc.spec.assertions,
    tags: doc.metadata.tags ?? doc.spec.tags,
    steps,
    auth: native?.auth,
    network: native?.network,
    exporters: native?.exporters,
    preCookies: native?.preCookies,
  };
}
