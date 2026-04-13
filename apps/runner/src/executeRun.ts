import type { Logger } from "@insightview/observability";
import {
  defaultTenant,
  type CheckRunStatus,
} from "@insightview/core";
import { insertResults, type ResultInput } from "@insightview/db";
import { runCheck, type MonitorSpec } from "@insightview/synthetic-kit";

/**
 * Platform-mode runner adapter. After ADR 0008 this module is a thin
 * wrapper around @insightview/synthetic-kit's runCheck — the same
 * library the Actions-native mode uses. The runner's only job is to:
 *
 *   1. Build a MonitorSpec from the BullMQ CheckScheduledPayload.
 *   2. Invoke synthetic-kit's runCheck with platform exporters wired in.
 *   3. Translate the returned ResultEnvelope into CheckResult rows in
 *      Postgres and propagate the terminal status to the caller.
 *
 * This eliminates the code duplication between apps/runner and
 * packages/synthetic-kit — every reliability fix (bundled web-vitals,
 * bypassCSP, forced visibilitychange, Navigation Timing fallback,
 * error classification, auth, network profiles) now lives in ONE
 * place and benefits both modes.
 */

export type TerminalRunStatus = Exclude<CheckRunStatus, "QUEUED" | "RUNNING">;

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

export async function executeBrowserRun(
  params: ExecuteRunParams,
): Promise<ExecuteRunOutcome> {
  const ctx = defaultTenant(`runner:${params.runnerId}`);

  const spec: MonitorSpec = {
    name: params.checkName,
    targetUrl: params.targetUrl,
    timeoutMs: params.timeoutMs,
    assertions: params.assertions,
    steps: [
      {
        name: "navigate",
        url: params.targetUrl,
        waitFor: {
          networkIdle: false,
          timeoutMs: Math.max(5_000, params.timeoutMs - 10_000),
        },
      },
    ],
    // Platform runner always emits the Pushgateway mirror + stdout.
    // S3 is opt-in via env vars; the healthchecks/platform exporters
    // are off here because they're the concern of the PLATFORM-side
    // alerting engine (which consumes CheckCompleted events).
    exporters: [
      { type: "stdout" },
      ...(process.env.PROMETHEUS_PUSHGATEWAY
        ? ([{ type: "pushgateway" }] as const)
        : []),
      ...(process.env.S3_BUCKET ? ([{ type: "s3" }] as const) : []),
    ],
  };

  const envelope = await runCheck(spec, {
    tenantId: params.tenantId,
    location: `platform-runner:${params.runnerId}`,
    artifactsDir: `/tmp/insightview/runs/${params.runId}`,
  });

  // Map synthetic-kit's envelope back into Prisma CheckResult rows.
  const resultInputs: ResultInput[] = envelope.steps.map((step) => ({
    runId: params.runId,
    stepName: step.name,
    url: step.url,
    durationMs: step.durationMs,
    status: step.status,
    webVitals: step.webVitals as Record<string, number>,
    resourceStats: step.resourceStats as unknown as Record<string, unknown>,
    navigationStats: step.navigationTiming as unknown as Record<string, unknown>,
    assertionsPassed: step.assertions.filter((a) => a.passed).length,
    assertionsFailed: step.assertions.filter((a) => !a.passed).length,
    traceS3Key: null,
    screenshotS3Key: null,
  }));

  let resultIds: string[] = [];
  try {
    const rows = await insertResults(ctx, resultInputs);
    resultIds = rows.map((r) => r.id);
  } catch (err) {
    params.log.error({ err }, "failed to persist results");
  }

  // The envelope status includes PARTIAL, which the DB enum does not;
  // fold it into PASSED (it means "the monitor ran, we got metrics,
  // but some were missing"). INFRA_FAILURE maps to ERROR.
  const status: TerminalRunStatus =
    envelope.status === "PASSED"
      ? "PASSED"
      : envelope.status === "PARTIAL"
        ? "PASSED"
        : envelope.status === "TIMEOUT"
          ? "TIMEOUT"
          : envelope.status === "FAILED"
            ? "FAILED"
            : "ERROR";

  return {
    status,
    durationMs: envelope.durationMs,
    resultIds,
    summary: {
      passedAssertions: envelope.summary.passedAssertions,
      failedAssertions: envelope.summary.failedAssertions,
      webVitals: envelope.summary.webVitals as Record<string, number>,
    },
    errorMessage: envelope.errorMessage,
  };
}
