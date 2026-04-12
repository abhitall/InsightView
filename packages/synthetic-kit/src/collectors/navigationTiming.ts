import type { Page } from "playwright";
import type { NavigationTiming } from "../types.js";

/**
 * Navigation Timing API collector. This is the *fallback* that the
 * whole reliability story rests on — when web-vitals injection fails
 * (CSP, air-gapped runner, broken upstream), we can still emit TTFB,
 * FCP, DNS, TLS, DOM and load metrics derived from the native
 * PerformanceNavigationTiming entry.
 *
 * Guaranteed to never throw. Returns an empty object on any error.
 */
export async function collectNavigationTiming(
  page: Page,
): Promise<NavigationTiming> {
  if (page.isClosed()) return {};
  try {
    return await page.evaluate(() => {
      const out: Record<string, number | string> = {};
      const nav = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming | undefined;
      const paint = performance.getEntriesByType("paint");
      if (nav) {
        out.ttfb = Math.max(0, nav.responseStart - nav.requestStart);
        out.dnsLookup = Math.max(0, nav.domainLookupEnd - nav.domainLookupStart);
        out.tlsTime =
          nav.secureConnectionStart > 0
            ? Math.max(0, nav.connectEnd - nav.secureConnectionStart)
            : 0;
        out.domContentLoaded = Math.max(
          0,
          nav.domContentLoadedEventEnd - nav.startTime,
        );
        out.pageLoad = Math.max(0, nav.loadEventEnd - nav.startTime);
        if (typeof nav.transferSize === "number") {
          out.transferSize = nav.transferSize;
        }
        if (nav.nextHopProtocol) {
          out.protocol = nav.nextHopProtocol;
        }
      }
      const fcp = paint.find((p) => p.name === "first-contentful-paint");
      if (fcp) out.fcp = fcp.startTime;
      return out as unknown as NavigationTiming;
    });
  } catch {
    return {};
  }
}
