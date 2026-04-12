import { loadApiConfig, apiRequest } from "../apiClient.js";

export async function statusCommand(_args: string[]): Promise<number> {
  const checkName = process.env.INSIGHTVIEW_CHECK_NAME;
  if (!checkName) {
    console.error("INSIGHTVIEW_CHECK_NAME is required for 'status'");
    return 1;
  }
  const config = loadApiConfig();
  const runs = await apiRequest<{ items: Array<{ id: string; status: string; scheduledAt: string }> }>(
    config,
    `/v1/runs?checkName=${encodeURIComponent(checkName)}&limit=10`,
  );
  if (runs.items.length === 0) {
    console.log(`No runs for check '${checkName}'`);
    return 0;
  }
  for (const run of runs.items) {
    console.log(`${run.scheduledAt}  ${run.status.padEnd(8)}  ${run.id}`);
  }
  const latest = runs.items[0];
  return latest.status === "PASSED" ? 0 : 1;
}
