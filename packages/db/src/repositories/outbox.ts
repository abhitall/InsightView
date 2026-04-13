import type { TenantContext } from "@insightview/core";
import { prisma } from "../client.js";
import type { DomainEvent, Prisma } from "../generated/client/index.js";

/**
 * Outbox repository (ADR 0010). Writers call `appendDomainEvent`
 * inside their existing Prisma transaction to guarantee the
 * domain event lands in the same unit-of-work as the business row.
 * The OutboxPublisher (in apps/scheduler) then reads unpublished
 * rows and ships them to Kafka.
 *
 * `markPublished` flips the `publishedAt` column rather than
 * deleting the row, avoiding Postgres MVCC bloat from frequent
 * deletes on a high-throughput table.
 */

export interface DomainEventInput {
  id: string;
  topic: string;
  type: string;
  payload: Record<string, unknown>;
  traceId?: string;
}

export async function appendDomainEvent(
  ctx: TenantContext,
  input: DomainEventInput,
  tx?: Prisma.TransactionClient,
): Promise<DomainEvent> {
  const client = tx ?? prisma;
  return client.domainEvent.create({
    data: {
      id: input.id,
      tenantId: ctx.tenantId,
      topic: input.topic,
      type: input.type,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      traceId: input.traceId ?? null,
    },
  });
}

export async function listUnpublishedEvents(
  limit = 200,
): Promise<DomainEvent[]> {
  return prisma.domainEvent.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function markPublished(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await prisma.domainEvent.updateMany({
    where: { id: { in: ids } },
    data: { publishedAt: new Date() },
  });
  return res.count;
}

export async function reapOldEvents(
  olderThanMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const res = await prisma.domainEvent.deleteMany({
    where: {
      publishedAt: { not: null, lt: cutoff },
    },
  });
  return res.count;
}
