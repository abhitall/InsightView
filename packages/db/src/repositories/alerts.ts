import type { TenantContext } from "@insightview/core";
import { NotFoundError } from "@insightview/core";
import type {
  AlertStrategy as CoreStrategy,
  Severity as CoreSeverity,
} from "@insightview/core";
import { prisma } from "../client.js";
import type {
  AlertRule,
  AlertIncident,
  Prisma,
} from "../generated/client/index.js";

export interface AlertRuleInput {
  name: string;
  checkId?: string | null;
  enabled?: boolean;
  strategy: CoreStrategy;
  expression: Record<string, unknown>;
  severity: CoreSeverity;
  cooldownSeconds?: number;
  channelIds?: string[];
}

export async function listAlertRules(
  ctx: TenantContext,
): Promise<AlertRule[]> {
  return prisma.alertRule.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "asc" },
  });
}

export async function listEnabledRulesForCheck(
  ctx: TenantContext,
  checkId: string,
): Promise<AlertRule[]> {
  return prisma.alertRule.findMany({
    where: {
      tenantId: ctx.tenantId,
      enabled: true,
      OR: [{ checkId: null }, { checkId }],
    },
  });
}

export async function upsertAlertRule(
  ctx: TenantContext,
  input: AlertRuleInput,
): Promise<AlertRule> {
  const data: Prisma.AlertRuleUncheckedCreateInput = {
    tenantId: ctx.tenantId,
    name: input.name,
    checkId: input.checkId ?? null,
    enabled: input.enabled ?? true,
    strategy: input.strategy,
    expression: input.expression as unknown as Prisma.InputJsonValue,
    severity: input.severity,
    cooldownSeconds: input.cooldownSeconds ?? 300,
    channelIds: input.channelIds ?? [],
  };

  return prisma.alertRule.upsert({
    where: {
      tenantId_name: { tenantId: ctx.tenantId, name: input.name },
    },
    create: data,
    update: data,
  });
}

export async function getAlertRuleByName(
  ctx: TenantContext,
  name: string,
): Promise<AlertRule> {
  const rule = await prisma.alertRule.findFirst({
    where: { tenantId: ctx.tenantId, name },
  });
  if (!rule) throw new NotFoundError("AlertRule", name);
  return rule;
}

export interface IncidentInput {
  id: string;
  ruleId: string;
  checkId?: string | null;
  runId?: string | null;
  severity: CoreSeverity;
  dedupeKey: string;
  payload: Record<string, unknown>;
}

export async function findFiringIncident(
  ctx: TenantContext,
  dedupeKey: string,
): Promise<AlertIncident | null> {
  return prisma.alertIncident.findFirst({
    where: { tenantId: ctx.tenantId, dedupeKey, status: "FIRING" },
  });
}

export async function createIncident(
  ctx: TenantContext,
  input: IncidentInput,
): Promise<AlertIncident> {
  return prisma.alertIncident.create({
    data: {
      id: input.id,
      tenantId: ctx.tenantId,
      ruleId: input.ruleId,
      checkId: input.checkId ?? null,
      runId: input.runId ?? null,
      severity: input.severity,
      dedupeKey: input.dedupeKey,
      status: "FIRING",
      payload: input.payload as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function resolveIncidentsForRule(
  ctx: TenantContext,
  ruleId: string,
): Promise<number> {
  const result = await prisma.alertIncident.updateMany({
    where: {
      tenantId: ctx.tenantId,
      ruleId,
      status: "FIRING",
    },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
    },
  });
  return result.count;
}

export async function markIncidentNotified(
  incidentId: string,
): Promise<void> {
  await prisma.alertIncident.update({
    where: { id: incidentId },
    data: { lastNotifiedAt: new Date() },
  });
}

export async function listIncidents(
  ctx: TenantContext,
  limit = 50,
): Promise<AlertIncident[]> {
  return prisma.alertIncident.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { openedAt: "desc" },
    take: limit,
  });
}
