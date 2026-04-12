import type { TenantContext } from "@insightview/core";
import { NotFoundError } from "@insightview/core";
import { prisma } from "../client.js";
import type { Check, Prisma } from "../generated/client/index.js";

export interface CheckInput {
  name: string;
  description?: string | null;
  type?: "BROWSER" | "API" | "TCP";
  enabled?: boolean;
  schedule: string;
  targetUrl: string;
  timeoutMs?: number;
  retries?: number;
  locations?: string[];
  scriptRef?: string | null;
  assertions?: Array<{ type: string; value: string }>;
  tags?: string[];
  sourceYaml?: string | null;
  sourceYamlHash?: string | null;
}

export async function listChecks(ctx: TenantContext): Promise<Check[]> {
  return prisma.check.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "asc" },
  });
}

export async function listEnabledChecks(ctx: TenantContext): Promise<Check[]> {
  return prisma.check.findMany({
    where: { tenantId: ctx.tenantId, enabled: true },
  });
}

export async function getCheckById(
  ctx: TenantContext,
  id: string,
): Promise<Check> {
  const check = await prisma.check.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!check) throw new NotFoundError("Check", id);
  return check;
}

export async function getCheckByName(
  ctx: TenantContext,
  name: string,
): Promise<Check> {
  const check = await prisma.check.findFirst({
    where: { name, tenantId: ctx.tenantId },
  });
  if (!check) throw new NotFoundError("Check", name);
  return check;
}

export async function findCheckByName(
  ctx: TenantContext,
  name: string,
): Promise<Check | null> {
  return prisma.check.findFirst({
    where: { name, tenantId: ctx.tenantId },
  });
}

export async function upsertCheck(
  ctx: TenantContext,
  input: CheckInput,
): Promise<Check> {
  const data: Prisma.CheckUncheckedCreateInput = {
    tenantId: ctx.tenantId,
    name: input.name,
    description: input.description ?? null,
    type: input.type ?? "BROWSER",
    enabled: input.enabled ?? true,
    schedule: input.schedule,
    targetUrl: input.targetUrl,
    timeoutMs: input.timeoutMs ?? 30000,
    retries: input.retries ?? 0,
    locations: input.locations ?? ["local"],
    scriptRef: input.scriptRef ?? null,
    assertions: (input.assertions ?? []) as unknown as Prisma.InputJsonValue,
    tags: input.tags ?? [],
    sourceYaml: input.sourceYaml ?? null,
    sourceYamlHash: input.sourceYamlHash ?? null,
  };

  return prisma.check.upsert({
    where: {
      tenantId_name: { tenantId: ctx.tenantId, name: input.name },
    },
    create: data,
    update: data,
  });
}

export async function deleteCheck(
  ctx: TenantContext,
  id: string,
): Promise<void> {
  await prisma.check.deleteMany({
    where: { id, tenantId: ctx.tenantId },
  });
}
