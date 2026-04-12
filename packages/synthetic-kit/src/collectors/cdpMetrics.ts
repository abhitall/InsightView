import type { Page } from "playwright";
import type { CdpMetrics } from "../types.js";

/**
 * Chrome DevTools Protocol metrics. Performance.getMetrics exposes
 * richer internals than web-vitals — JS heap, layout counts, script
 * duration — that are useful for distinguishing "slow render" from
 * "slow network" during incident triage. Chromium only.
 */
export async function collectCdpMetrics(page: Page): Promise<CdpMetrics> {
  if (page.isClosed()) return {};
  try {
    const client = await page.context().newCDPSession(page);
    try {
      const { metrics } = (await client.send("Performance.getMetrics")) as {
        metrics: Array<{ name: string; value: number }>;
      };
      const map = new Map(metrics.map((m) => [m.name, m.value]));
      return {
        jsHeapUsedSize: map.get("JSHeapUsedSize"),
        jsHeapTotalSize: map.get("JSHeapTotalSize"),
        layoutCount: map.get("LayoutCount"),
        scriptDuration: map.get("ScriptDuration"),
      };
    } finally {
      await client.detach().catch(() => {});
    }
  } catch {
    return {};
  }
}
