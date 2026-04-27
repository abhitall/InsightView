import type { TenantContext } from "@insightview/core";
import { prisma } from "../client.js";
import type { CheckResult, Prisma } from "../generated/client/index.js";

export interface ResultInput {
  runId: string;
  stepName: string;
  url: string;
  durationMs: number;
  status: string;
  webVitals: Record<string, number>;
  resourceStats: Record<string, unknown>;
  navigationStats: Record<string, unknown>;
  assertionsPassed: number;
  assertionsFailed: number;
  traceS3Key?: string | null;
  screenshotS3Key?: string | null;
}

export async function insertResults(
  ctx: TenantContext,
  inputs: ResultInput[],
): Promise<CheckResult[]> {
  if (inputs.length === 0) return [];
  const created: CheckResult[] = [];
  for (const input of inputs) {
    const row = await prisma.checkResult.create({
      data: {
        tenantId: ctx.tenantId,
        runId: input.runId,
        stepName: input.stepName,
        url: input.url,
        durationMs: input.durationMs,
        status: input.status,
        webVitals: input.webVitals as unknown as Prisma.InputJsonValue,
        resourceStats: input.resourceStats as unknown as Prisma.InputJsonValue,
        navigationStats: input.navigationStats as unknown as Prisma.InputJsonValue,
        assertionsPassed: input.assertionsPassed,
        assertionsFailed: input.assertionsFailed,
        traceS3Key: input.traceS3Key ?? null,
        screenshotS3Key: input.screenshotS3Key ?? null,
      },
    });
    created.push(row);
  }
  return created;
}

export async function listResultsByRun(
  ctx: TenantContext,
  runId: string,
): Promise<CheckResult[]> {
  return prisma.checkResult.findMany({
    where: { runId, tenantId: ctx.tenantId },
    orderBy: { createdAt: "asc" },
  });
}
