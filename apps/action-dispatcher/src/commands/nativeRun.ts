import { parseMonitorPath, runCheck } from "@insightview/synthetic-kit";
import { setOutput, appendSummary } from "../githubOutputs.js";

/**
 * `native-run` command. Runs every monitor in the given path via
 * the Actions-native synthetic kit — no platform API, no Docker
 * compose stack, no database required. Just a Playwright run inside
 * the GitHub Actions runner with bundled web-vitals, proper
 * visibility-change finalization, and every exporter plumbed in.
 *
 * Exit code:
 *   0 — every monitor PASSED or PARTIAL
 *   1 — at least one monitor FAILED, ERROR, or TIMEOUT
 *
 * PARTIAL runs are deliberately NOT an exit-1: they indicate that
 * we collected some metrics but not all (e.g. LCP didn't resolve),
 * which is still useful data. Alerting should distinguish the two
 * via the envelope status field.
 */
export async function nativeRunCommand(args: string[]): Promise<number> {
  let path = process.env.INSIGHTVIEW_MONITORS_PATH ?? "monitors";
  const heartbeatUrl = process.env.INSIGHTVIEW_HEARTBEAT_URL;
  const artifactsDir = process.env.INSIGHTVIEW_ARTIFACTS_DIR ?? "artifacts";
  const location = process.env.INSIGHTVIEW_LOCATION ?? "github-actions";
  const filter = process.env.INSIGHTVIEW_MONITOR ?? process.env.INSIGHTVIEW_CHECK_NAME;

  // Support `--spec <path>` flag from action.yml dispatch.
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--spec" || args[i] === "-s") {
      path = args[i + 1];
    }
  }

  console.log(`[native-run] loading monitors from ${path}`);
  const specs = parseMonitorPath(path);
  if (specs.length === 0) {
    console.error(`[native-run] no monitors found at ${path}`);
    return 1;
  }

  const filteredSpecs = filter
    ? specs.filter((s) => s.name === filter)
    : specs;
  if (filter && filteredSpecs.length === 0) {
    console.error(`[native-run] monitor '${filter}' not found in ${path}`);
    return 1;
  }

  console.log(
    `[native-run] executing ${filteredSpecs.length} monitor(s): ${filteredSpecs
      .map((s) => s.name)
      .join(", ")}`,
  );

  let hardFail = false;
  const summaryLines: string[] = [
    "## InsightView Actions-native run",
    "",
    "| Monitor | Status | Duration | Steps | Assertions |",
    "|---------|--------|----------|-------|------------|",
  ];

  for (const spec of filteredSpecs) {
    const envelope = await runCheck(spec, { artifactsDir, location });
    const { status, durationMs, summary } = envelope;
    const icon =
      status === "PASSED"
        ? "✅"
        : status === "PARTIAL"
          ? "⚠️"
          : status === "FAILED"
            ? "❌"
            : "💥";
    summaryLines.push(
      `| \`${spec.name}\` | ${icon} ${status} | ${durationMs}ms | ${summary.passedSteps}/${summary.totalSteps} | ${summary.passedAssertions}✓ / ${summary.failedAssertions}✗ |`,
    );
    if (
      status !== "PASSED" &&
      status !== "PARTIAL"
    ) {
      hardFail = true;
    }
  }

  appendSummary(summaryLines.join("\n"));
  setOutput("run_status", hardFail ? "FAILED" : "PASSED");

  // Heartbeat for the dead-man's-switch. Only pinged on success
  // because the healthchecks exporter handles failure-pings already.
  if (!hardFail && heartbeatUrl) {
    try {
      await fetch(heartbeatUrl, { method: "POST" });
      console.log("[native-run] heartbeat ping sent");
    } catch (err) {
      console.warn(`[native-run] heartbeat ping failed: ${(err as Error).message}`);
    }
  }

  return hardFail ? 1 : 0;
}
