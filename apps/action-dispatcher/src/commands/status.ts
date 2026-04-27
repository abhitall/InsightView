import { loadApiConfig, apiRequest } from "../apiClient.js";
import { setOutput, appendSummary } from "../githubOutputs.js";

/**
 * `status` command. Queries the platform API for the latest runs
 * of a check and prints them. Exit code depends on the latest
 * status and the `--fail-on-degrade` flag (the PR deploy-gate
 * pattern from docs/ROADMAP.md Phase 4).
 *
 * Flags:
 *   --fail-on-degrade        exit non-zero when the latest run
 *                            is PARTIAL or FLAKY, in addition to
 *                            the default FAILED/ERROR case.
 *   --window N               look at the last N runs (default 10).
 *   --min-success-ratio F    exit non-zero if less than F of the
 *                            window passed (0.0–1.0, default 1.0).
 */
export async function statusCommand(args: string[]): Promise<number> {
  const checkName = process.env.INSIGHTVIEW_CHECK_NAME;
  if (!checkName) {
    console.error("INSIGHTVIEW_CHECK_NAME is required for 'status'");
    return 1;
  }
  const flags = parseFlags(args);
  const config = loadApiConfig();
  const runs = await apiRequest<{
    items: Array<{
      id: string;
      status: string;
      scheduledAt: string;
      errorMessage?: string;
    }>;
  }>(
    config,
    `/v1/runs?checkName=${encodeURIComponent(checkName)}&limit=${flags.window}`,
  );
  if (runs.items.length === 0) {
    console.log(`No runs for check '${checkName}'`);
    setOutput("latest_status", "NONE");
    return flags.failOnDegrade ? 1 : 0;
  }
  for (const run of runs.items) {
    console.log(`${run.scheduledAt}  ${run.status.padEnd(8)}  ${run.id}`);
  }
  const latest = runs.items[0];
  setOutput("latest_status", latest.status);

  const passed = runs.items.filter((r) => r.status === "PASSED").length;
  const ratio = passed / runs.items.length;
  setOutput("success_ratio", ratio.toFixed(2));

  appendSummary(
    `## InsightView status: \`${checkName}\`\n\n- Latest: **${latest.status}**\n- Window: ${runs.items.length} runs\n- Success ratio: ${(ratio * 100).toFixed(0)}%\n`,
  );

  if (latest.status !== "PASSED") {
    if (latest.status === "PARTIAL") {
      return flags.failOnDegrade ? 1 : 0;
    }
    return 1;
  }
  if (ratio < flags.minSuccessRatio) {
    console.error(
      `success ratio ${(ratio * 100).toFixed(0)}% < required ${(flags.minSuccessRatio * 100).toFixed(0)}%`,
    );
    return 1;
  }
  return 0;
}

interface StatusFlags {
  failOnDegrade: boolean;
  window: number;
  minSuccessRatio: number;
}

function parseFlags(args: string[]): StatusFlags {
  let failOnDegrade = false;
  let window = 10;
  let minSuccessRatio = 1.0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--fail-on-degrade") failOnDegrade = true;
    else if (a === "--window" && args[i + 1]) {
      window = parseInt(args[++i], 10);
    } else if (a === "--min-success-ratio" && args[i + 1]) {
      minSuccessRatio = parseFloat(args[++i]);
    }
  }
  if (process.env.INSIGHTVIEW_FAIL_ON_DEGRADE === "true") failOnDegrade = true;
  return { failOnDegrade, window, minSuccessRatio };
}
