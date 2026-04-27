import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadApiConfig, apiRequest } from "../apiClient.js";
import { appendSummary } from "../githubOutputs.js";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ya?ml)$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

export async function deployCommand(_args: string[]): Promise<number> {
  const monitorsPath = process.env.INSIGHTVIEW_MONITORS_PATH ?? "monitors";
  const actor = process.env.GITHUB_ACTOR ?? "cli";
  const config = loadApiConfig();

  let files: string[] = [];
  try {
    files = walk(monitorsPath);
  } catch (err) {
    console.error(`Failed to read monitors directory '${monitorsPath}':`, (err as Error).message);
    return 1;
  }
  if (files.length === 0) {
    console.log(`No YAML files found under ${monitorsPath}`);
    return 0;
  }

  const combined = files.map((f) => readFileSync(f, "utf8")).join("\n---\n");
  const res = await apiRequest<{
    appliedChecks: string[];
    appliedRules: string[];
    deploymentId: string;
  }>(config, "/v1/monitors/apply", {
    method: "POST",
    body: JSON.stringify({
      yaml: combined,
      actor,
      source: "ACTION",
    }),
  });

  console.log(
    `Deployed ${res.appliedChecks.length} checks and ${res.appliedRules.length} alert rules (deployment ${res.deploymentId})`,
  );
  appendSummary(
    `## InsightView deploy\n- files: ${files.length}\n- checks applied: ${res.appliedChecks.join(", ")}\n- alert rules applied: ${res.appliedRules.join(", ")}\n- deploymentId: ${res.deploymentId}\n`,
  );
  return 0;
}
