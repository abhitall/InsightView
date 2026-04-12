import { chromium, type Browser, type Page } from "playwright";
import type { Logger } from "@insightview/observability";
import { defaultTenant, type CheckRunStatus } from "@insightview/core";
import { insertResults, type ResultInput } from "@insightview/db";
import { collectWebVitalsFromPage } from "./collectors/webVitals.js";
import { collectPerformanceSnapshot } from "./collectors/performance.js";
import { runAssertions } from "./assertions.js";
import { PrometheusPushgatewayExporter } from "./exporters/PrometheusPushgatewayExporter.js";
import { S3ArtifactExporter } from "./exporters/S3ArtifactExporter.js";

export interface ExecuteRunParams {
  runId: string;
  checkId: string;
  checkName: string;
  targetUrl: string;
  scriptRef: string;
  timeoutMs: number;
  assertions: Array<{ type: string; value: string }>;
  tenantId: string;
  runnerId: string;
  log: Logger;
}

export type TerminalRunStatus = Exclude<CheckRunStatus, "QUEUED" | "RUNNING">;

export interface ExecuteRunOutcome {
  status: TerminalRunStatus;
  durationMs: number;
  resultIds: string[];
  summary: {
    passedAssertions: number;
    failedAssertions: number;
    webVitals: Record<string, number>;
  };
  errorMessage?: string;
}

/**
 * Execute a browser-based check. Uses Playwright's chromium browser
 * directly (not the test runner) so each run is a plain async function
 * that writes structured results and artifacts.
 *
 * This preserves the spirit of the legacy monitoring() fixture — the
 * web-vitals collector injects the same library and the Prometheus
 * Pushgateway + S3 exporters are reused. The runner simply wraps them
 * in a worker-friendly async function instead of a Playwright fixture.
 */
export async function executeBrowserRun(
  params: ExecuteRunParams,
): Promise<ExecuteRunOutcome> {
  const start = Date.now();
  const ctx = defaultTenant(`runner:${params.runnerId}`);
  let browser: Browser | undefined;
  // Use a wrapper ref so callbacks (timeout handler, catch block) share a
  // single mutable status without TypeScript narrowing it away.
  const runState: { status: TerminalRunStatus; errorMessage?: string } = {
    status: "PASSED",
  };
  const resultInputs: ResultInput[] = [];
  let passedAssertions = 0;
  let failedAssertions = 0;
  const webVitalsAgg: Record<string, number> = {};

  const timeoutHandle = setTimeout(() => {
    runState.status = "TIMEOUT";
    runState.errorMessage = "Run exceeded timeout";
    try {
      browser?.close();
    } catch {
      /* ignore */
    }
  }, params.timeoutMs);

  let page: Page | undefined;
  let screenshotBuffer: Buffer | undefined;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (InsightView Runner) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    page = await context.newPage();

    params.log.info(
      { runId: params.runId, target: params.targetUrl },
      "navigating",
    );

    const navStart = Date.now();
    const response = await page.goto(params.targetUrl, {
      waitUntil: "load",
      timeout: Math.max(5000, params.timeoutMs - 10000),
    });
    const navDuration = Date.now() - navStart;

    // Give the page a moment to settle and report vitals.
    await page.waitForTimeout(500);

    const webVitals = await collectWebVitalsFromPage(page).catch((err) => {
      params.log.warn({ err }, "web vitals collection failed");
      return {} as Record<string, number>;
    });
    Object.assign(webVitalsAgg, webVitals);

    const perf = await collectPerformanceSnapshot(page).catch(() => ({
      resource: {
        totalRequests: 0,
        failedRequests: 0,
        totalBytes: 0,
        loadTime: 0,
      },
      navigation: {
        domContentLoaded: 0,
        load: 0,
        firstPaint: 0,
      },
    }));

    const bodyText = await page.content();
    const assertionResult = runAssertions(params.assertions, {
      responseStatus: response?.status() ?? 0,
      bodyHtml: bodyText,
      durationMs: navDuration,
    });
    passedAssertions = assertionResult.passed;
    failedAssertions = assertionResult.failed;
    if (failedAssertions > 0) {
      runState.status = "FAILED";
      runState.errorMessage = assertionResult.failureReasons.join("; ");
    }

    // Capture a screenshot as an artifact.
    try {
      screenshotBuffer = await page.screenshot({ fullPage: false, type: "png" });
    } catch (err) {
      params.log.warn({ err }, "screenshot capture failed");
    }

    resultInputs.push({
      runId: params.runId,
      stepName: "navigate",
      url: params.targetUrl,
      durationMs: navDuration,
      status: failedAssertions > 0 ? "failed" : "passed",
      webVitals,
      resourceStats: perf.resource,
      navigationStats: perf.navigation,
      assertionsPassed: passedAssertions,
      assertionsFailed: failedAssertions,
    });
  } catch (err) {
    if (runState.status !== "TIMEOUT") {
      runState.status = "ERROR";
    }
    runState.errorMessage = (err as Error).message;
    params.log.error({ err, runId: params.runId }, "run execution errored");
    resultInputs.push({
      runId: params.runId,
      stepName: "navigate",
      url: params.targetUrl,
      durationMs: Date.now() - start,
      status: "error",
      webVitals: {},
      resourceStats: {},
      navigationStats: {},
      assertionsPassed: 0,
      assertionsFailed: 1,
    });
  } finally {
    clearTimeout(timeoutHandle);
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }

  const durationMs = Date.now() - start;

  // Persist results to the DB.
  let resultIds: string[] = [];
  try {
    const rows = await insertResults(ctx, resultInputs);
    resultIds = rows.map((r) => r.id);
  } catch (err) {
    params.log.error({ err }, "failed to persist results");
  }

  // Fire-and-forget Prometheus push + S3 upload.
  try {
    const pushExporter = new PrometheusPushgatewayExporter();
    await pushExporter.export({
      checkName: params.checkName,
      runId: params.runId,
      status: runState.status,
      webVitals: webVitalsAgg,
      durationMs,
    });
  } catch (err) {
    params.log.warn({ err }, "pushgateway export failed");
  }

  if (screenshotBuffer) {
    try {
      const s3 = new S3ArtifactExporter();
      await s3.uploadScreenshot({
        runId: params.runId,
        checkName: params.checkName,
        buffer: screenshotBuffer,
      });
    } catch (err) {
      params.log.warn({ err }, "s3 screenshot upload failed");
    }
  }

  return {
    status: runState.status,
    durationMs,
    resultIds,
    summary: {
      passedAssertions,
      failedAssertions,
      webVitals: webVitalsAgg,
    },
    errorMessage: runState.errorMessage,
  };
}
