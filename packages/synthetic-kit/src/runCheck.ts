import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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
  /** Re-use an already-launched browser. When provided the function
   *  does NOT close the browser on exit — the caller owns its lifecycle.
   *  Used by runCheckBatch for memory-efficient back-to-back runs. */
  externalBrowser?: Browser;
  /** Emulate a throttled network profile. See NetworkEmulation below. */
  networkEmulation?: NetworkEmulation;
}

/**
 * CDP network throttling presets. Useful for monitoring "how fast
 * is the site on mobile 3G" baselines without ever leaving CI.
 * Values match Chrome DevTools preset definitions.
 */
export type NetworkEmulation =
  | "fast-3g"
  | "slow-3g"
  | "4g"
  | "offline"
  | {
      offline?: boolean;
      downloadKbps: number;
      uploadKbps: number;
      latencyMs: number;
    };

const EMULATION_PRESETS: Record<
  "fast-3g" | "slow-3g" | "4g" | "offline",
  { offline?: boolean; downloadKbps: number; uploadKbps: number; latencyMs: number }
> = {
  "fast-3g": { downloadKbps: 1600, uploadKbps: 750, latencyMs: 150 },
  "slow-3g": { downloadKbps: 500, uploadKbps: 500, latencyMs: 400 },
  "4g": { downloadKbps: 9000, uploadKbps: 9000, latencyMs: 20 },
  offline: { offline: true, downloadKbps: 0, uploadKbps: 0, latencyMs: 0 },
};

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
  const ownsBrowser = !opts.externalBrowser;
  try {
    if (opts.externalBrowser) {
      browser = opts.externalBrowser;
    } else {
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        ...launchOptions,
      });
    }

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

    // Apply CDP network throttling if requested.
    if (opts.networkEmulation) {
      await applyNetworkEmulation(context, opts.networkEmulation);
    }

    // Install the Web Vitals collector at the context level so it
    // runs on every page created afterward, BEFORE any page scripts.
    await installWebVitalsCollector(context);

    // OpenTelemetry trace propagation: inject W3C traceparent +
    // tracestate headers on every outbound request so the target's
    // backend can continue the same trace. The runner is the
    // "synthetic user" root of the trace; downstream services
    // appear as child spans correlated by trace id.
    const traceHeaders: Record<string, string> = {};
    try {
      // Lazy-resolve observability's injectTraceHeaders so
      // synthetic-kit doesn't hard-depend on OTel.
      const { injectTraceHeaders } = await import(
        "@insightview/observability"
      ).catch(() => ({ injectTraceHeaders: null }) as any);
      if (typeof injectTraceHeaders === "function") {
        injectTraceHeaders(traceHeaders);
      }
    } catch {
      /* tracing optional */
    }
    if (Object.keys(traceHeaders).length > 0) {
      await context.setExtraHTTPHeaders(traceHeaders);
    }

    const effectiveSteps = spec.steps ?? [
      { name: "navigate", url: spec.targetUrl },
    ];
    for (const step of effectiveSteps) {
      // Merge: per-step assertions override monitor-level ones.
      const effectiveStep = {
        ...step,
        assertions: step.assertions ?? spec.assertions ?? [],
      };
      const result = await runStepWithRetry({
        step: effectiveStep,
        context,
        runArtifactsDir,
        timeoutMs,
        maxAttempts: 1 + (spec.retries ?? 0),
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
    if (ownsBrowser) {
      try {
        await browser?.close();
      } catch {
        /* ignore */
      }
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

interface RunStepWithRetryArgs extends RunStepArgs {
  maxAttempts: number;
}

/**
 * Retry wrapper. Follows the monitoring-industry "three strikes"
 * pattern: we attempt a step up to `maxAttempts` times ONLY if the
 * failure is classified as TARGET_DOWN or INFRA_FAILURE (transient).
 * TARGET_ERROR failures (assertion mismatches) never retry — that's
 * the whole point of assertions.
 *
 * If a step passes on the second or later attempt, we set
 * `flaky: true` on the result so alert rules can surface flakiness
 * without hard-failing. This implements the `--fail-on-flaky-tests`
 * semantic from the research plan.
 */
async function runStepWithRetry(
  args: RunStepWithRetryArgs,
): Promise<StepResult> {
  let lastResult: StepResult | undefined;
  for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
    const result = await runStep({
      step: args.step,
      context: args.context,
      runArtifactsDir: args.runArtifactsDir,
      timeoutMs: args.timeoutMs,
    });
    result.attempts = attempt;
    if (result.status === "passed" || result.status === "partial") {
      if (attempt > 1) {
        result.flaky = true;
      }
      return result;
    }
    // Non-transient failures (assertion errors) skip further retries.
    if (
      result.errorCategory === ErrorCategory.TARGET_ERROR &&
      attempt >= 1
    ) {
      return result;
    }
    lastResult = result;
  }
  return (
    lastResult ?? {
      name: args.step.name,
      url: args.step.url,
      durationMs: 0,
      status: "error",
      webVitals: {},
      navigationTiming: {},
      resourceStats: { totalRequests: 0, failedRequests: 0, totalBytes: 0 },
      cdpMetrics: {},
      assertions: [],
    }
  );
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

    // Capture CDN cache hit/miss from response headers. The set of
    // headers we look for covers the major CDNs: Cloudflare, Fastly,
    // Akamai, CloudFront, Vercel.
    const headers = response?.headers() ?? {};
    stepResult.cdnCache = classifyCacheHeaders(headers);

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

/**
 * Detect CDN cache hit/miss from response headers. The header
 * conventions we cover:
 *
 *   cf-cache-status: HIT | MISS | BYPASS | DYNAMIC | EXPIRED | REVALIDATED
 *   x-cache:        HIT | MISS | HIT-from-cloudfront | ...
 *   x-cache-status: HIT | MISS
 *   x-vercel-cache: HIT | MISS
 *   x-served-by:    usually Fastly — treat presence as UNKNOWN
 *   age:            cache age in seconds, indicates edge-cached
 */
function classifyCacheHeaders(
  headers: Record<string, string>,
): import("./types.js").CdnCacheInfo {
  const check = (name: string) => {
    const v = headers[name.toLowerCase()];
    if (!v) return null;
    return { source: name, raw: v };
  };
  const sources = [
    check("cf-cache-status"),
    check("x-cache"),
    check("x-cache-status"),
    check("x-vercel-cache"),
  ].filter((x): x is { source: string; raw: string } => x !== null);
  if (sources.length === 0) {
    return { status: "UNKNOWN" };
  }
  const first = sources[0];
  const upper = first.raw.toUpperCase();
  const status: "HIT" | "MISS" | "UNKNOWN" = upper.includes("HIT")
    ? "HIT"
    : upper.includes("MISS")
      ? "MISS"
      : "UNKNOWN";
  const ageHeader = headers["age"];
  return {
    status,
    source: first.source,
    raw: first.raw,
    age: ageHeader ? parseInt(ageHeader, 10) : undefined,
  };
}

/**
 * Apply Chrome DevTools network throttling to a context. Uses the
 * CDP Network.emulateNetworkConditions command on a fresh session.
 */
async function applyNetworkEmulation(
  context: BrowserContext,
  emulation: import("./runCheck.js").NetworkEmulation,
): Promise<void> {
  const preset =
    typeof emulation === "string" ? EMULATION_PRESETS[emulation] : emulation;
  if (!preset) return;
  try {
    // The throttle applies to every page opened in the context; we
    // install it via addInitScript fail-safe with a CDP fallback
    // when the first page opens. Simpler: install on a dedicated
    // throwaway page and then close it.
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send("Network.emulateNetworkConditions", {
      offline: preset.offline ?? false,
      downloadThroughput: (preset.downloadKbps * 1024) / 8,
      uploadThroughput: (preset.uploadKbps * 1024) / 8,
      latency: preset.latencyMs,
    });
    await client.detach();
    await page.close();
  } catch (err) {
    console.warn(
      `[runCheck] network emulation failed: ${(err as Error).message}`,
    );
  }
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
