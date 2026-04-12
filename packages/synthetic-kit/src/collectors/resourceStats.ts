import type { Page } from "playwright";
import type { ResourceStats } from "../types.js";

/**
 * Resource statistics via PerformanceResourceTiming entries. Used to
 * compute transfer sizes and count failed requests (responseStatus=0
 * is what the browser reports when a fetch fails at the network
 * layer).
 */
export async function collectResourceStats(page: Page): Promise<ResourceStats> {
  const empty: ResourceStats = {
    totalRequests: 0,
    failedRequests: 0,
    totalBytes: 0,
  };
  if (page.isClosed()) return empty;
  try {
    return await page.evaluate(() => {
      const resources = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      const totalRequests = resources.length;
      const failedRequests = resources.filter((r) => {
        const status = (r as unknown as { responseStatus?: number }).responseStatus;
        return typeof status === "number" && status === 0;
      }).length;
      const totalBytes = resources.reduce(
        (acc, r) => acc + (r.transferSize || r.encodedBodySize || 0),
        0,
      );
      return { totalRequests, failedRequests, totalBytes };
    });
  } catch {
    return empty;
  }
}
