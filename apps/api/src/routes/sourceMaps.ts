import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { upsertSourceMap, listSourceMapsByRelease } from "@insightview/db";
import { deobfuscateStack } from "../services/sourceMapResolver.js";

/**
 * Source map routes. Customers POST their source maps once per
 * release (e.g. from a CI/CD step after bundling) and the platform
 * stores them by (tenant, release, bundleUrl). The enrichment
 * pipeline looks them up when processing RUM error events.
 */

const UploadBody = z.object({
  release: z.string().min(1),
  bundleUrl: z.string().min(1),
  content: z.string().min(1),
});

const ResolveBody = z.object({
  release: z.string().min(1),
  stack: z.string().min(1),
});

export async function registerSourceMapRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/v1/source-maps", async (req, reply) => {
    const body = UploadBody.parse(req.body);
    const row = await upsertSourceMap(req.tenant, body);
    reply.status(201);
    return {
      id: row.id,
      contentHash: row.contentHash,
      release: row.release,
      bundleUrl: row.bundleUrl,
    };
  });

  app.get<{ Querystring: { release?: string } }>(
    "/v1/source-maps",
    async (req) => {
      const release = req.query.release;
      if (!release) return { items: [] };
      const rows = await listSourceMapsByRelease(req.tenant, release);
      return {
        items: rows.map((r) => ({
          id: r.id,
          release: r.release,
          bundleUrl: r.bundleUrl,
          contentHash: r.contentHash,
          createdAt: r.createdAt,
        })),
      };
    },
  );

  app.post("/v1/source-maps/resolve", async (req) => {
    const body = ResolveBody.parse(req.body);
    const resolved = await deobfuscateStack(req.tenant, body.release, body.stack);
    return { resolved };
  });
}
