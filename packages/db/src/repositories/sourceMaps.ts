import { createHash } from "node:crypto";
import type { TenantContext } from "@insightview/core";
import { prisma } from "../client.js";
import type { SourceMap } from "../generated/client/index.js";

/**
 * Source map repository. Uploaded source maps are keyed by
 * (tenantId, release, bundleUrl) so the error enrichment pipeline
 * can look up the correct map for a given frame URL + app version.
 */

export interface SourceMapInput {
  release: string;
  bundleUrl: string;
  content: string;
}

export async function upsertSourceMap(
  ctx: TenantContext,
  input: SourceMapInput,
): Promise<SourceMap> {
  const contentHash = createHash("sha256").update(input.content).digest("hex");
  return prisma.sourceMap.upsert({
    where: {
      tenantId_release_bundleUrl: {
        tenantId: ctx.tenantId,
        release: input.release,
        bundleUrl: input.bundleUrl,
      },
    },
    create: {
      tenantId: ctx.tenantId,
      release: input.release,
      bundleUrl: input.bundleUrl,
      content: input.content,
      contentHash,
    },
    update: {
      content: input.content,
      contentHash,
    },
  });
}

export async function findSourceMap(
  ctx: TenantContext,
  release: string,
  bundleUrl: string,
): Promise<SourceMap | null> {
  return prisma.sourceMap.findUnique({
    where: {
      tenantId_release_bundleUrl: {
        tenantId: ctx.tenantId,
        release,
        bundleUrl,
      },
    },
  });
}

export async function listSourceMapsByRelease(
  ctx: TenantContext,
  release: string,
): Promise<SourceMap[]> {
  return prisma.sourceMap.findMany({
    where: { tenantId: ctx.tenantId, release },
    orderBy: { createdAt: "desc" },
  });
}
