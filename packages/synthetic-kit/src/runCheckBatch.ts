import { chromium, type Browser } from "playwright";
import type { MonitorSpec, ResultEnvelope } from "./types.js";
import { runCheck, type RunCheckOptions } from "./runCheck.js";

/**
 * Batch runner. Memory-management pattern for long-running scenarios
 * where you want to run N monitors back-to-back without paying the
 * browser cold-start cost every time but also without leaking memory.
 *
 * Strategy:
 *   1. Launch a shared browser with sandboxed args.
 *   2. Run up to `recycleEvery` monitors against it, creating a
 *      fresh BrowserContext per monitor (safest isolation level
 *      Playwright supports).
 *   3. After `recycleEvery` runs, close the browser and spin up
 *      a fresh one. This caps heap growth caused by the
 *      BrowserContext leak noted in Playwright's issue tracker.
 *
 * Each monitor still goes through `runCheck` so ALL the reliability
 * fixes apply (web-vitals injection, bypassCSP, error classification,
 * exporters). The batch runner is purely a resource-management layer.
 */

export interface RunBatchOptions extends RunCheckOptions {
  /** Recycle the shared browser after every N runs. Default 20. */
  recycleEvery?: number;
}

export async function runCheckBatch(
  specs: MonitorSpec[],
  opts: RunBatchOptions = {},
): Promise<ResultEnvelope[]> {
  const recycleEvery = opts.recycleEvery ?? 20;
  const results: ResultEnvelope[] = [];
  let sinceRecycle = 0;
  let browser: Browser | undefined;

  const launch = async () => {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  };

  await launch();

  try {
    for (const spec of specs) {
      // We re-use the same runCheck entry point, but tell it to
      // borrow our pre-launched browser instead of spinning its own.
      const envelope = await runCheck(spec, {
        ...opts,
        externalBrowser: browser,
      });
      results.push(envelope);

      sinceRecycle++;
      if (sinceRecycle >= recycleEvery) {
        try {
          await browser?.close();
        } catch {
          /* ignore */
        }
        await launch();
        sinceRecycle = 0;
      }
    }
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }

  return results;
}
