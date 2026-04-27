import type { TenantContext } from "@insightview/core";
import type { NotificationChannelType } from "@insightview/core";
import { prisma } from "../client.js";
import type {
  NotificationChannel,
  Prisma,
} from "../generated/client/index.js";

export interface ChannelInput {
  name: string;
  type: NotificationChannelType;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export async function listChannels(
  ctx: TenantContext,
): Promise<NotificationChannel[]> {
  return prisma.notificationChannel.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { name: "asc" },
  });
}

export async function upsertChannel(
  ctx: TenantContext,
  input: ChannelInput,
): Promise<NotificationChannel> {
  const data: Prisma.NotificationChannelUncheckedCreateInput = {
    tenantId: ctx.tenantId,
    name: input.name,
    type: input.type,
    config: (input.config ?? {}) as unknown as Prisma.InputJsonValue,
    enabled: input.enabled ?? true,
  };
  return prisma.notificationChannel.upsert({
    where: { tenantId_name: { tenantId: ctx.tenantId, name: input.name } },
    create: data,
    update: data,
  });
}

export async function findChannelsByNames(
  ctx: TenantContext,
  names: string[],
): Promise<NotificationChannel[]> {
  if (names.length === 0) return [];
  return prisma.notificationChannel.findMany({
    where: { tenantId: ctx.tenantId, name: { in: names }, enabled: true },
  });
}
