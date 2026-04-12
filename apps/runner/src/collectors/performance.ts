import type { Page } from "playwright";

export interface PerformanceSnapshot {
  resource: {
    totalRequests: number;
    failedRequests: number;
    totalBytes: number;
    loadTime: number;
  };
  navigation: {
    domContentLoaded: number;
    load: number;
    firstPaint: number;
  };
}

export async function collectPerformanceSnapshot(
  page: Page,
): Promise<PerformanceSnapshot> {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    const totalRequests = resources.length;
    const failedRequests = resources.filter(
      (r) => (r as unknown as { responseStatus?: number }).responseStatus === 0,
    ).length;
    const totalBytes = resources.reduce(
      (acc, r) => acc + (r.transferSize || r.encodedBodySize || 0),
      0,
    );
    const loadTime = resources.length
      ? Math.max(...resources.map((r) => r.responseEnd))
      : 0;

    const nav = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    const firstPaint = performance.getEntriesByName("first-paint")[0]?.startTime ?? 0;

    return {
      resource: {
        totalRequests,
        failedRequests,
        totalBytes,
        loadTime,
      },
      navigation: nav
        ? {
            domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
            load: nav.loadEventEnd - nav.startTime,
            firstPaint,
          }
        : { domContentLoaded: 0, load: 0, firstPaint: 0 },
    };
  });
}
