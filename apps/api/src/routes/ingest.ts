import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  findCheckByName,
  upsertCheck,
  createRun,
  markRunStarted,
  markRunCompleted,
  insertResults,
  type ResultInput,
} from "@insightview/db";
import { createRunId } from "@insightview/core";

/**
 * Platform ingest endpoint. Accepts a ResultEnvelope from an
 * Actions-native run (emitted by the `platform` exporter) and
 * creates the corresponding Check + CheckRun + CheckResult rows.
 *
 * This is the bridge between the two execution modes: teams that
 * start in Actions-native can layer the platform on top later
 * without rewriting any monitors. The envelope shape is stable so
 * ingest is versioned (version: 1) for future envelope changes.
 */

const IngestBody = z.object({
  runId: z.string(),
  monitor: z.string(),
  tenantId: z.string().optional(),
  location: z.string().optional(),
  status: z.enum(["PASSED", "FAILED", "PARTIAL", "ERROR", "TIMEOUT"]),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  steps: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      durationMs: z.number().int().nonnegative(),
      status: z.enum(["passed", "failed", "error", "partial"]),
      statusCode: z.number().int().optional(),
      webVitals: z.record(z.number()).default({}),
      navigationTiming: z.record(z.unknown()).default({}),
      resourceStats: z
        .object({
          totalRequests: z.number(),
          failedRequests: z.number(),
          totalBytes: z.number(),
        })
        .default({ totalRequests: 0, failedRequests: 0, totalBytes: 0 }),
      cdpMetrics: z.record(z.unknown()).default({}),
      assertions: z
        .array(
          z.object({
            type: z.string(),
            value: z.string(),
            passed: z.boolean(),
            detail: z.string().optional(),
          }),
        )
        .default([]),
      errorCategory: z.string().optional(),
      errorMessage: z.string().optional(),
      screenshotPath: z.string().optional(),
    }),
  ),
  summary: z
    .object({
      totalSteps: z.number(),
      passedSteps: z.number(),
      failedSteps: z.number(),
      webVitals: z.record(z.number()).default({}),
      totalRequests: z.number(),
      failedRequests: z.number(),
      passedAssertions: z.number(),
      failedAssertions: z.number(),
    })
    .optional(),
  errorCategory: z.string().optional(),
  errorMessage: z.string().optional(),
  githubContext: z.record(z.unknown()).optional(),
});

export async function registerIngestRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/v1/runs/ingest", async (req, reply) => {
    const envelope = IngestBody.parse(req.body);

    // Ensure the Check exists. Teams running Actions-native mode
    // may forward envelopes without having deployed monitors-as-code
    // first; create the Check lazily with enabled=false so the
    // platform's scheduler doesn't start firing it independently.
    let check = await findCheckByName(req.tenant, envelope.monitor);
    if (!check) {
      check = await upsertCheck(req.tenant, {
        name: envelope.monitor,
        description: "Auto-created from Actions-native ingest",
        type: "BROWSER",
        enabled: false, // platform scheduler should not run this
        schedule: "0 0 31 2 *", // never
        targetUrl: envelope.steps[0]?.url ?? "unknown",
        tags: ["auto-ingested", "actions-native"],
      });
    }

    // Allocate a CheckRun row using the envelope's runId as the DB ID
    // so downstream lookups work.
    const dbRunId = createRunId(); // we prefix our own to avoid collisions
    const scheduledAt = new Date(envelope.startedAt);
    await createRun(req.tenant, {
      runId: dbRunId,
      checkId: check.id,
      scheduledAt,
      triggeredBy: "API",
    });
    await markRunStarted(req.tenant, dbRunId, "ingest");
    await markRunCompleted(
      req.tenant,
      dbRunId,
      envelope.status === "PARTIAL"
        ? "PASSED"
        : envelope.status === "TIMEOUT"
          ? "TIMEOUT"
          : envelope.status === "FAILED"
            ? "FAILED"
            : envelope.status === "ERROR"
              ? "ERROR"
              : "PASSED",
      envelope.errorMessage,
    );

    // Persist per-step results.
    const inputs: ResultInput[] = envelope.steps.map((step) => ({
      runId: dbRunId,
      stepName: step.name,
      url: step.url,
      durationMs: step.durationMs,
      status: step.status,
      webVitals: step.webVitals,
      resourceStats: step.resourceStats,
      navigationStats: step.navigationTiming,
      assertionsPassed: step.assertions.filter((a) => a.passed).length,
      assertionsFailed: step.assertions.filter((a) => !a.passed).length,
    }));
    await insertResults(req.tenant, inputs);

    reply.status(202);
    return {
      accepted: true,
      dbRunId,
      checkId: check.id,
      externalRunId: envelope.runId,
    };
  });
}
