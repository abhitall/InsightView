import type { TenantContext } from "@insightview/core";
import { NotFoundError } from "@insightview/core";
import type {
  CheckRunStatus as CoreStatus,
  TriggerSource,
} from "@insightview/core";
import { prisma } from "../client.js";
import type { CheckRun } from "../generated/client/index.js";

export interface CreateRunInput {
  runId: string;
  checkId: string;
  scheduledAt: Date;
  triggeredBy: TriggerSource;
}

export async function createRun(
  ctx: TenantContext,
  input: CreateRunInput,
): Promise<CheckRun> {
  return prisma.checkRun.create({
    data: {
      id: input.runId,
      tenantId: ctx.tenantId,
      checkId: input.checkId,
      scheduledAt: input.scheduledAt,
      triggeredBy: input.triggeredBy,
      status: "QUEUED",
    },
  });
}

export async function getRunById(
  ctx: TenantContext,
  runId: string,
): Promise<CheckRun> {
  const run = await prisma.checkRun.findFirst({
    where: { id: runId, tenantId: ctx.tenantId },
  });
  if (!run) throw new NotFoundError("CheckRun", runId);
  return run;
}

export async function findRunById(
  ctx: TenantContext,
  runId: string,
): Promise<CheckRun | null> {
  return prisma.checkRun.findFirst({
    where: { id: runId, tenantId: ctx.tenantId },
  });
}

export async function listRunsByCheck(
  ctx: TenantContext,
  checkId: string,
  limit = 50,
): Promise<CheckRun[]> {
  return prisma.checkRun.findMany({
    where: { checkId, tenantId: ctx.tenantId },
    orderBy: { scheduledAt: "desc" },
    take: limit,
  });
}

export async function markRunStarted(
  ctx: TenantContext,
  runId: string,
  runnerId: string,
): Promise<CheckRun | null> {
  // Only transition QUEUED -> RUNNING. updateMany returns count so we can
  // detect an idempotent duplicate claim attempt.
  const result = await prisma.checkRun.updateMany({
    where: { id: runId, tenantId: ctx.tenantId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date(), runnerId },
  });
  if (result.count === 0) return null;
  return getRunById(ctx, runId);
}

export async function markRunCompleted(
  ctx: TenantContext,
  runId: string,
  status: Exclude<CoreStatus, "QUEUED" | "RUNNING">,
  errorMessage?: string,
): Promise<CheckRun> {
  await prisma.checkRun.update({
    where: { id: runId },
    data: {
      status,
      completedAt: new Date(),
      errorMessage: errorMessage ?? null,
    },
  });
  return getRunById(ctx, runId);
}

export async function listStaleRunningRuns(
  olderThanMs: number,
): Promise<CheckRun[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  return prisma.checkRun.findMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: cutoff },
    },
  });
}
