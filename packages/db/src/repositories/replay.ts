import type { TenantContext } from "@insightview/core";
import { prisma } from "../client.js";
import type { RumReplayChunk } from "../generated/client/index.js";

/**
 * Session replay chunk repository. Replay events are stored
 * append-only, one row per batch flushed by the SDK. The
 * dashboard reconstructs a session timeline by ordering chunks
 * by sessionId + sequence.
 */

export interface ReplayChunkInput {
  sessionId: string;
  siteId: string;
  sequence: number;
  payload: string;
}

export async function insertReplayChunks(
  ctx: TenantContext,
  chunks: ReplayChunkInput[],
): Promise<number> {
  if (chunks.length === 0) return 0;
  const res = await prisma.rumReplayChunk.createMany({
    data: chunks.map((c) => ({
      tenantId: ctx.tenantId,
      sessionId: c.sessionId,
      siteId: c.siteId,
      sequence: c.sequence,
      payload: c.payload,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

export async function listReplayChunks(
  ctx: TenantContext,
  sessionId: string,
): Promise<RumReplayChunk[]> {
  return prisma.rumReplayChunk.findMany({
    where: { tenantId: ctx.tenantId, sessionId },
    orderBy: { sequence: "asc" },
  });
}

export async function countReplayChunksForSite(
  ctx: TenantContext,
  siteId: string,
): Promise<number> {
  return prisma.rumReplayChunk.count({
    where: { tenantId: ctx.tenantId, siteId },
  });
}
