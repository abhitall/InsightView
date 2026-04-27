import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { insertReplayChunks, upsertSession } from "@insightview/db";
import { defaultTenant } from "@insightview/core";

/**
 * Session replay ingest endpoint. Accepts base64/JSON rrweb event
 * chunks from the RUM SDK's replay module and stores them for
 * later playback. Chunks are sequenced per-session so the client
 * can reconstruct the timeline in order.
 */

const ChunkBody = z.object({
  siteId: z.string().min(1),
  sessionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  payload: z.string().min(1),
});

export async function registerReplayRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/v1/replay", async (req, reply) => {
    const body = ChunkBody.parse(req.body);
    const ctx = defaultTenant("rum-replay");

    // Make sure we have a session row for this chunk (may arrive
    // before the first event batch if replay starts immediately).
    await upsertSession(ctx, {
      id: body.sessionId,
      siteId: body.siteId,
      userAgent: String(req.headers["user-agent"] ?? "unknown"),
      pageCount: 0,
    });

    const count = await insertReplayChunks(ctx, [
      {
        sessionId: body.sessionId,
        siteId: body.siteId,
        sequence: body.sequence,
        payload: body.payload,
      },
    ]);

    reply.status(202);
    return { accepted: count };
  });
}
