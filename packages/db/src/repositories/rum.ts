import type { TenantContext } from "@insightview/core";
import type { RumEventType } from "@insightview/core";
import { prisma } from "../client.js";
import type {
  RumEvent,
  RumSession,
  Prisma,
} from "../generated/client/index.js";

export interface RumEventInput {
  id: string;
  sessionId: string;
  siteId: string;
  type: RumEventType;
  name: string;
  value?: number;
  rating?: string;
  url: string;
  occurredAt: Date;
  attributes: Record<string, unknown>;
}

export interface RumSessionUpsertInput {
  id: string;
  siteId: string;
  userAgent: string;
  country?: string | null;
  deviceCategory?: string | null;
  pageCount?: number;
}

export async function upsertSession(
  ctx: TenantContext,
  input: RumSessionUpsertInput,
): Promise<RumSession> {
  return prisma.rumSession.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      tenantId: ctx.tenantId,
      siteId: input.siteId,
      userAgent: input.userAgent,
      country: input.country ?? null,
      deviceCategory: input.deviceCategory ?? null,
      pageCount: input.pageCount ?? 1,
    },
    update: {
      lastSeenAt: new Date(),
      pageCount: { increment: input.pageCount ?? 0 },
    },
  });
}

export async function insertRumEvents(
  ctx: TenantContext,
  events: RumEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;
  const result = await prisma.rumEvent.createMany({
    data: events.map((e) => ({
      id: e.id,
      tenantId: ctx.tenantId,
      sessionId: e.sessionId,
      siteId: e.siteId,
      type: e.type,
      name: e.name,
      value: e.value ?? null,
      rating: e.rating ?? null,
      url: e.url,
      occurredAt: e.occurredAt,
      attributes: e.attributes as unknown as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export interface RumQueryOptions {
  siteId?: string;
  type?: RumEventType;
  sessionId?: string;
  since?: Date;
  limit?: number;
}

export async function listRumEvents(
  ctx: TenantContext,
  opts: RumQueryOptions,
): Promise<RumEvent[]> {
  return prisma.rumEvent.findMany({
    where: {
      tenantId: ctx.tenantId,
      siteId: opts.siteId,
      type: opts.type,
      sessionId: opts.sessionId,
      receivedAt: opts.since ? { gte: opts.since } : undefined,
    },
    orderBy: { receivedAt: "desc" },
    take: opts.limit ?? 100,
  });
}

export async function listRumSessions(
  ctx: TenantContext,
  siteId?: string,
  limit = 50,
): Promise<RumSession[]> {
  return prisma.rumSession.findMany({
    where: { tenantId: ctx.tenantId, siteId },
    orderBy: { lastSeenAt: "desc" },
    take: limit,
  });
}

export async function rumWebVitalSummary(
  ctx: TenantContext,
  siteId: string,
  sinceMs = 24 * 60 * 60 * 1000,
): Promise<Array<{ metric: string; count: number; avg: number }>> {
  const since = new Date(Date.now() - sinceMs);
  const rows = await prisma.rumEvent.groupBy({
    by: ["name"],
    where: {
      tenantId: ctx.tenantId,
      siteId,
      type: "WEB_VITAL",
      receivedAt: { gte: since },
    },
    _count: { _all: true },
    _avg: { value: true },
  });
  return rows.map((r) => ({
    metric: r.name,
    count: r._count._all,
    avg: r._avg.value ?? 0,
  }));
}

export interface RumWebVitalDistribution {
  metric: string;
  count: number;
  mean: number;
  p50: number;
  p75: number;
  p95: number;
}

/**
 * Real percentile aggregation over RUM web-vital observations using
 * Postgres' `percentile_cont` continuous-percentile function. Used by
 * the alerting evaluator's RUM_METRIC strategy in place of the prior
 * `avg * 1.2 / avg * 1.5` placeholder. Falls back to mean when the
 * dataset is too small for a meaningful percentile.
 */
export async function rumWebVitalPercentiles(
  ctx: TenantContext,
  siteId: string,
  sinceMs = 24 * 60 * 60 * 1000,
): Promise<RumWebVitalDistribution[]> {
  const since = new Date(Date.now() - sinceMs);
  type Row = {
    name: string;
    count: bigint | number;
    mean: number | null;
    p50: number | null;
    p75: number | null;
    p95: number | null;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      "name" as name,
      count(*)::bigint as count,
      avg("value")::double precision as mean,
      percentile_cont(0.5) within group (order by "value") as p50,
      percentile_cont(0.75) within group (order by "value") as p75,
      percentile_cont(0.95) within group (order by "value") as p95
    FROM "RumEvent"
    WHERE "tenantId" = ${ctx.tenantId}
      AND "siteId" = ${siteId}
      AND "type"::text = 'WEB_VITAL'
      AND "receivedAt" >= ${since}
      AND "value" IS NOT NULL
    GROUP BY "name"
  `;
  return rows.map((r) => {
    const mean = r.mean ?? 0;
    return {
      metric: r.name,
      count: typeof r.count === "bigint" ? Number(r.count) : r.count,
      mean,
      p50: r.p50 ?? mean,
      p75: r.p75 ?? mean,
      p95: r.p95 ?? mean,
    };
  });
}
