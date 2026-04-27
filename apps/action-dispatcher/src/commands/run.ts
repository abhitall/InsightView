import { loadApiConfig, apiRequest } from "../apiClient.js";
import { setOutput, appendSummary } from "../githubOutputs.js";

export async function runCommand(_args: string[]): Promise<number> {
  const checkName = process.env.INSIGHTVIEW_CHECK_NAME;
  const waitForTerminal = (process.env.INSIGHTVIEW_WAIT ?? "true") === "true";
  if (!checkName) {
    console.error("INSIGHTVIEW_CHECK_NAME environment variable is required for 'run'");
    return 1;
  }
  const config = loadApiConfig();
  console.log(`Triggering run for check '${checkName}' via ${config.baseUrl}`);
  const triggered = await apiRequest<{ runId: string; status: string }>(
    config,
    "/v1/runs",
    {
      method: "POST",
      body: JSON.stringify({ checkName, triggeredBy: "ACTION" }),
    },
  );
  console.log(`Run accepted: ${triggered.runId}`);
  setOutput("run_id", triggered.runId);

  if (!waitForTerminal) {
    appendSummary(`## InsightView run started\n- checkName: ${checkName}\n- runId: ${triggered.runId}\n`);
    return 0;
  }

  const deadline = Date.now() + 5 * 60 * 1000;
  let lastStatus = triggered.status;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const run = await apiRequest<{ id: string; status: string }>(
      config,
      `/v1/runs/${encodeURIComponent(triggered.runId)}`,
    );
    lastStatus = run.status;
    if (["PASSED", "FAILED", "ERROR", "TIMEOUT"].includes(run.status)) {
      console.log(`Run finished with status: ${run.status}`);
      setOutput("run_status", run.status);
      appendSummary(
        `## InsightView run result\n- checkName: ${checkName}\n- runId: ${triggered.runId}\n- status: **${run.status}**\n`,
      );
      return run.status === "PASSED" ? 0 : 1;
    }
  }
  console.error(`Run did not complete within deadline (last status: ${lastStatus})`);
  setOutput("run_status", "TIMEOUT");
  return 1;
}
