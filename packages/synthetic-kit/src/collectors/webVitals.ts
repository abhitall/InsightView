import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Page, BrowserContext } from "playwright";
import type { WebVitals } from "../types.js";

/**
 * Web Vitals collector — the most failure-prone piece of the whole
 * kit. Implements every reliability fix uncovered in the research:
 *
 *   1. Bundles web-vitals IIFE content at process start (never
 *      loads from unpkg CDN) so CSP + offline CI runners work.
 *   2. Registers handlers with `reportAllChanges: true` so LCP/CLS
 *      emit values continuously, not just at page-hide.
 *   3. Forces a `visibilitychange → hidden` dispatch to finalize
 *      LCP and CLS — the #1 reason headless Playwright runs report
 *      zero web vitals.
 *   4. Simulates a click to trigger INP so it has at least one
 *      interaction to measure.
 *   5. Uses `addInitScript` on the *context* before the first
 *      navigation so the library is installed before page scripts
 *      start running (and before any CSP takes effect).
 *
 * The `collect()` function assumes that the caller already arranged
 * for `installWebVitalsCollector(context)` to be called on the
 * context before navigating. If `window.__insightview_vitals` is
 * missing at collection time we return an empty object; Navigation
 * Timing will still have partial data.
 */

function loadIife(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("web-vitals/dist/web-vitals.iife.js");
    return readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
}

const WEB_VITALS_IIFE = loadIife();

/**
 * Install the Web Vitals collector on a browser context. Call this
 * ONCE, before the first page.goto(), so the library is injected
 * before page scripts run.
 */
export async function installWebVitalsCollector(
  context: BrowserContext,
): Promise<void> {
  if (!WEB_VITALS_IIFE) return;
  // Step 1: make the library available on every page in the context.
  await context.addInitScript({ content: WEB_VITALS_IIFE });
  // Step 2: register handlers with reportAllChanges so LCP/CLS/INP
  // emit values early and often. We stash them on window so the
  // collect() call can pull them out later.
  await context.addInitScript(() => {
    // @ts-ignore runtime injected
    const wv = (window as any).webVitals;
    if (!wv) return;
    const vitals: Record<string, number> = {};
    (window as any).__insightview_vitals = vitals;
    const handle = (m: { name: string; value: number }) => {
      vitals[m.name] = m.value;
    };
    try {
      wv.onCLS?.(handle, { reportAllChanges: true });
      wv.onFCP?.(handle);
      wv.onLCP?.(handle, { reportAllChanges: true });
      wv.onINP?.(handle, { reportAllChanges: true });
      wv.onTTFB?.(handle);
      // FID was removed in web-vitals v4 — guard the call.
      if (typeof wv.onFID === "function") {
        wv.onFID(handle, { reportAllChanges: true });
      }
    } catch {
      /* never throw from instrumentation */
    }
  });
}

/**
 * Force LCP and CLS to finalize by simulating `visibilitychange →
 * hidden`. Must be called BEFORE collecting vitals. Safe to call
 * even if web-vitals failed to inject.
 */
export async function finalizeWebVitals(page: Page): Promise<void> {
  try {
    // Simulate a user interaction so INP has something to measure.
    await page.click("body", { timeout: 500, force: true }).catch(() => {});
    // Give LCP a chance to register the post-interaction paint.
    await page.waitForTimeout(200);
    // Dispatch visibilitychange → hidden. This is the event that
    // web-vitals listens for to finalize LCP and CLS.
    await page.evaluate(() => {
      try {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          writable: true,
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      } catch {
        /* ignore */
      }
    });
    // Give listeners a moment to run.
    await page.waitForTimeout(200);
  } catch {
    /* ignore — we'll return whatever vitals were captured */
  }
}

export async function collectWebVitals(page: Page): Promise<WebVitals> {
  if (page.isClosed()) return {};
  try {
    await finalizeWebVitals(page);
    const vitals = await page.evaluate(() => {
      const v = (window as unknown as { __insightview_vitals?: Record<string, number> })
        .__insightview_vitals;
      return v ?? {};
    });
    return vitals as WebVitals;
  } catch {
    return {};
  }
}

export function isWebVitalsBundled(): boolean {
  return WEB_VITALS_IIFE !== null;
}
