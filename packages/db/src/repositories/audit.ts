import type { TenantContext } from "@insightview/core";
import { prisma } from "../client.js";
import type { AuditLog, Prisma } from "../generated/client/index.js";

/**
 * Audit log repository (ADR 0012). Every mutating API request
 * emits a row. The resource + resourceId fields form a
 * compound lookup so "all changes to rule X" is fast.
 */

export interface AuditLogInput {
  actor: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(
  ctx: TenantContext,
  input: AuditLogInput,
): Promise<AuditLog> {
  return prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actor: input.actor,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId ?? null,
      metadata: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function listAuditLogs(
  ctx: TenantContext,
  opts: {
    resource?: string;
    resourceId?: string;
    limit?: number;
  } = {},
): Promise<AuditLog[]> {
  return prisma.auditLog.findMany({
    where: {
      tenantId: ctx.tenantId,
      resource: opts.resource,
      resourceId: opts.resourceId,
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
  });
}
