import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Page } from "playwright";

/**
 * Web Vitals collection for the runner.
 *
 * Strategy: load the `web-vitals` IIFE bundle from node_modules at
 * process start (via createRequire to support pnpm's content-addressable
 * store) and inject it as inline script content. This avoids any network
 * round-trip and works in air-gapped / firewalled environments.
 *
 * If the bundle can't be resolved for some reason we gracefully fall
 * back to a CDN fetch guarded by a short timeout — and if that also
 * fails we return an empty metrics object so the run still completes.
 */

const METRIC_WINDOW_MS = 2000;

function loadWebVitalsContent(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("web-vitals/dist/web-vitals.iife.js");
    return readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
}

const WEB_VITALS_SCRIPT: string | null = loadWebVitalsContent();

export async function collectWebVitalsFromPage(
  page: Page,
): Promise<Record<string, number>> {
  if (page.isClosed()) return {};

  if (WEB_VITALS_SCRIPT) {
    try {
      await page.addScriptTag({ content: WEB_VITALS_SCRIPT });
    } catch {
      /* swallow */
    }
  } else {
    try {
      await Promise.race([
        page.addScriptTag({
          url: "https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js",
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("web-vitals CDN timeout")), 3000),
        ),
      ]);
    } catch {
      // Air-gapped environment — return empty metrics.
    }
  }

  try {
    const metrics = await page.evaluate(
      (windowMs) =>
        new Promise<Record<string, number>>((resolve) => {
          const result: Record<string, number> = {};
          // @ts-ignore runtime-injected
          const wv = (window as any).webVitals;
          const finalize = () => resolve(result);
          if (!wv) {
            finalize();
            return;
          }
          const record = (m: { name: string; value: number }) => {
            result[m.name] = m.value;
          };
          try {
            wv.onCLS?.(record);
            wv.onFCP?.(record);
            wv.onLCP?.(record);
            wv.onINP?.(record);
            wv.onTTFB?.(record);
            wv.onFID?.(record);
          } catch {
            /* ignore */
          }
          setTimeout(finalize, windowMs);
        }),
      METRIC_WINDOW_MS,
    );
    return metrics;
  } catch {
    return {};
  }
}
