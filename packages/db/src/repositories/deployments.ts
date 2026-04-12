import type { TenantContext } from "@insightview/core";
import { prisma } from "../client.js";
import type { MonitorDeployment, Prisma } from "../generated/client/index.js";

export interface DeploymentInput {
  actor: string;
  source: "ACTION" | "API" | "CLI";
  yamlHash: string;
  diff: Record<string, unknown>;
}

export async function recordDeployment(
  ctx: TenantContext,
  input: DeploymentInput,
): Promise<MonitorDeployment> {
  return prisma.monitorDeployment.create({
    data: {
      tenantId: ctx.tenantId,
      actor: input.actor,
      source: input.source,
      yamlHash: input.yamlHash,
      diff: input.diff as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function listDeployments(
  ctx: TenantContext,
  limit = 20,
): Promise<MonitorDeployment[]> {
  return prisma.monitorDeployment.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
