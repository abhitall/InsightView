import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import {
  ErrorCategory,
  RunStatus,
  type ResultEnvelope,
  type StepResult,
  type MonitorSpec,
  type WebVitals,
} from "./types.js";
import { classifyError } from "./errors.js";
import { runAssertions } from "./assertions.js";
import {
  collectNavigationTimingFn,
  collectResourceStatsFn,
  collectCdpMetricsFn,
} from "./collectors/fns.js";
import {
  installWebVitalsCollector,
  collectWebVitals,
} from "./collectors/webVitals.js";
import { authStrategyFor } from "./auth/index.js";
import { networkProfileFor } from "./network/index.js";
import { exporterFor } from "./exporters/index.js";

export interface RunCheckOptions {
  location?: string;
  artifactsDir?: string;
  tenantId?: string;
}

/**
 * Orchestrate one run of a monitor spec. This is the main entry
 * point used by the action-dispatcher's `native-run` command. It:
 *
 *   1. Launches Chromium with the appropriate network profile.
 *   2. Creates a fresh BrowserContext with bypassCSP and the auth
 *      strategy applied (storage state, form login, TOTP, OAuth,
 *      mTLS, or none).
 *   3. Installs the Web Vitals collector on the context BEFORE the
 *      first navigation, so the library is present when page
 *      scripts execute.
 *   4. Walks the declared steps, navigating with app-type-aware
 *      wait strategies, running assertions, and collecting metrics.
 *   5. ALWAYS emits an envelope — if collection fails partially we
 *      still report what we have and mark the run PARTIAL.
 *   6. Ships the envelope through every configured exporter.
 */
export async function runCheck(
  spec: MonitorSpec,
  opts: RunCheckOptions = {},
): Promise<ResultEnvelope> {
  const runId = randomUUID();
  const startedAt = new Date();
  const artifactsDir = opts.artifactsDir ?? "artifacts";
  const runArtifactsDir = join(artifactsDir, spec.name, runId);
  mkdirSync(runArtifactsDir, { recursive: true });

  const location = opts.location ?? process.env.INSIGHTVIEW_LOCATION ?? "github-actions";
  const tenantId = opts.tenantId ?? "default";
  const timeoutMs = spec.timeoutMs ?? 60_000;

  const networkProfile = networkProfileFor(spec.network?.profile ?? "direct");
  const launchOptions = networkProfile.launchOptions(spec.network?.config ?? {});
  const contextOptions = networkProfile.contextOptions(spec.network?.config ?? {});

  const steps: StepResult[] = [];
  let envelope: ResultEnvelope = buildEnvelope({
    runId,
    spec,
    tenantId,
    location,
    startedAt,
    steps,
  });

  const safetyTimer = setTimeout(() => {
    // The catch block in the try below handles cleanup when this
    // fires — we just mark the run TIMEOUT and close the browser.
    envelope = markTimeout(envelope);
    void browser?.close().catch(() => {});
  }, timeoutMs + 5_000);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      ...launchOptions,
    });

    const context = await browser.newContext({
      bypassCSP: true,
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (InsightView Actions Runner) Chrome/120.0 Safari/537.36",
      ...contextOptions,
    });

    // Pre-set consent cookies so the consent banner doesn't become the LCP.
    if (spec.preCookies && spec.preCookies.length > 0) {
      await context.addCookies(
        spec.preCookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain ?? new URL(spec.targetUrl).hostname,
          path: c.path ?? "/",
        })),
      );
    }

    // Apply auth strategy (storage state, form login, TOTP, etc.)
    if (spec.auth) {
      const auth = authStrategyFor(spec.auth.strategy);
      await auth.apply(context, spec.auth.config);
    }

    // Install the Web Vitals collector at the context level so it
    // runs on every page created afterward, BEFORE any page scripts.
    await installWebVitalsCollector(context);

    const effectiveSteps = spec.steps ?? [
      { name: "navigate", url: spec.targetUrl },
    ];
    for (const step of effectiveSteps) {
      // Merge: per-step assertions override monitor-level ones.
      const effectiveStep = {
        ...step,
        assertions: step.assertions ?? spec.assertions ?? [],
      };
      const result = await runStep({
        step: effectiveStep,
        context,
        runArtifactsDir,
        timeoutMs,
      });
      steps.push(result);
    }

    await context.close();
    clearTimeout(safetyTimer);
    envelope = buildEnvelope({
      runId,
      spec,
      tenantId,
      location,
      startedAt,
      steps,
      completedAt: new Date(),
    });
  } catch (err) {
    clearTimeout(safetyTimer);
    const classified = classifyError(err);
    envelope = buildEnvelope({
      runId,
      spec,
      tenantId,
      location,
      startedAt,
      steps,
      completedAt: new Date(),
      errorCategory: classified.category,
      errorMessage: classified.reason,
    });
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }

  envelope.githubContext = readGithubContext();

  // Fire every configured exporter, plus stdout by default so the
  // Actions log always has the envelope even if the others fail.
  const exporters = spec.exporters ?? [{ type: "stdout" }];
  for (const cfg of exporters) {
    try {
      const exporter = exporterFor(cfg.type);
      await exporter.export(envelope, cfg.config ?? {});
    } catch (err) {
      console.warn(`[runCheck] exporter ${cfg.type} failed: ${(err as Error).message}`);
    }
  }

  return envelope;
}

interface RunStepArgs {
  step: NonNullable<MonitorSpec["steps"]>[number];
  context: import("playwright").BrowserContext;
  runArtifactsDir: string;
  timeoutMs: number;
}

async function runStep({
  step,
  context,
  runArtifactsDir,
  timeoutMs,
}: RunStepArgs): Promise<StepResult> {
  const stepStart = Date.now();
  const page = await context.newPage();
  const stepResult: StepResult = {
    name: step.name,
    url: step.url,
    durationMs: 0,
    status: "passed",
    webVitals: {},
    navigationTiming: {},
    resourceStats: { totalRequests: 0, failedRequests: 0, totalBytes: 0 },
    cdpMetrics: {},
    assertions: [],
  };

  try {
    const response = await page.goto(step.url, {
      waitUntil: step.waitFor?.networkIdle ? "networkidle" : "load",
      timeout: step.waitFor?.timeoutMs ?? Math.max(5_000, timeoutMs - 10_000),
    });
    stepResult.statusCode = response?.status() ?? 0;

    if (step.waitFor?.selector) {
      await page
        .waitForSelector(step.waitFor.selector, {
          timeout: step.waitFor.timeoutMs ?? 15_000,
        })
        .catch(() => {
          /* treated as partial later */
        });
    } else {
      // Small settle time for LCP candidate to stabilize.
      await page.waitForTimeout(500);
    }

    // Collect every metric, best-effort.
    stepResult.webVitals = await collectWebVitals(page);
    stepResult.navigationTiming = await collectNavigationTimingFn(page);
    stepResult.resourceStats = await collectResourceStatsFn(page);
    stepResult.cdpMetrics = await collectCdpMetricsFn(page);

    // Assertions
    const body = await page.content().catch(() => "");
    const title = (await page.title().catch(() => "")) || "";
    const assertions = step.assertions ?? [];
    const aResult = runAssertions(assertions, {
      statusCode: stepResult.statusCode ?? 0,
      bodyHtml: body,
      title,
      durationMs: Date.now() - stepStart,
      webVitals: stepResult.webVitals as WebVitals,
    });
    stepResult.assertions = aResult.results;
    if (aResult.failed > 0) {
      stepResult.status = "failed";
      stepResult.errorCategory = ErrorCategory.TARGET_ERROR;
      stepResult.errorMessage = aResult.failureReasons.join("; ");
    } else if (
      Object.keys(stepResult.webVitals).length === 0 &&
      (!stepResult.navigationTiming.ttfb || stepResult.navigationTiming.ttfb === 0)
    ) {
      // We collected nothing useful; flag as partial so alerting knows.
      stepResult.status = "partial";
      stepResult.errorCategory = ErrorCategory.PARTIAL;
      stepResult.errorMessage = "no metrics collected";
    }

    // Capture screenshot on pass OR fail — monitoring wants artifacts both ways.
    try {
      const screenshotPath = join(
        runArtifactsDir,
        `${sanitize(step.name)}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: false });
      stepResult.screenshotPath = screenshotPath;
    } catch {
      /* ignore */
    }
  } catch (err) {
    const classified = classifyError(err);
    stepResult.status = "error";
    stepResult.errorCategory = classified.category;
    stepResult.errorMessage = classified.reason;
    try {
      const screenshotPath = join(
        runArtifactsDir,
        `${sanitize(step.name)}-error.png`,
      );
      await page.screenshot({ path: screenshotPath }).catch(() => {});
      stepResult.screenshotPath = screenshotPath;
    } catch {
      /* ignore */
    }
  } finally {
    stepResult.durationMs = Date.now() - stepStart;
    await page.close().catch(() => {});
  }
  return stepResult;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

interface BuildEnvelopeArgs {
  runId: string;
  spec: MonitorSpec;
  tenantId: string;
  location: string;
  startedAt: Date;
  steps: StepResult[];
  completedAt?: Date;
  errorCategory?: ErrorCategory;
  errorMessage?: string;
}

function buildEnvelope(args: BuildEnvelopeArgs): ResultEnvelope {
  const completedAt = args.completedAt ?? new Date();
  const durationMs = completedAt.getTime() - args.startedAt.getTime();
  const passedSteps = args.steps.filter((s) => s.status === "passed").length;
  const failedSteps = args.steps.filter(
    (s) => s.status === "failed" || s.status === "error",
  ).length;
  const partialSteps = args.steps.filter((s) => s.status === "partial").length;
  const totalAssertionsPassed = args.steps.reduce(
    (acc, s) => acc + s.assertions.filter((a) => a.passed).length,
    0,
  );
  const totalAssertionsFailed = args.steps.reduce(
    (acc, s) => acc + s.assertions.filter((a) => !a.passed).length,
    0,
  );

  const webVitals: WebVitals = {};
  for (const step of args.steps) {
    for (const [k, v] of Object.entries(step.webVitals)) {
      if (typeof v === "number") {
        (webVitals as Record<string, number>)[k] = v;
      }
    }
  }

  const totalRequests = args.steps.reduce(
    (a, s) => a + s.resourceStats.totalRequests,
    0,
  );
  const failedRequests = args.steps.reduce(
    (a, s) => a + s.resourceStats.failedRequests,
    0,
  );

  let status: RunStatus;
  if (args.errorCategory === ErrorCategory.INFRA_FAILURE) {
    status = RunStatus.ERROR;
  } else if (failedSteps > 0) {
    status = RunStatus.FAILED;
  } else if (partialSteps > 0 || args.steps.length === 0) {
    status = RunStatus.PARTIAL;
  } else {
    status = RunStatus.PASSED;
  }

  return {
    runId: args.runId,
    monitor: args.spec.name,
    tenantId: args.tenantId,
    location: args.location,
    status,
    startedAt: args.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
    steps: args.steps,
    summary: {
      totalSteps: args.steps.length,
      passedSteps,
      failedSteps,
      webVitals,
      totalRequests,
      failedRequests,
      passedAssertions: totalAssertionsPassed,
      failedAssertions: totalAssertionsFailed,
    },
    errorCategory: args.errorCategory,
    errorMessage: args.errorMessage,
  };
}

function markTimeout(envelope: ResultEnvelope): ResultEnvelope {
  return {
    ...envelope,
    status: RunStatus.TIMEOUT,
    errorCategory: ErrorCategory.INFRA_FAILURE,
    errorMessage: "Run exceeded safety timeout",
  };
}

function readGithubContext(): ResultEnvelope["githubContext"] {
  return {
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    repository: process.env.GITHUB_REPOSITORY,
    workflow: process.env.GITHUB_WORKFLOW,
    actor: process.env.GITHUB_ACTOR,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
  };
}
