import { createHash, randomBytes } from "node:crypto";
import type { TenantContext } from "@insightview/core";
import { NotFoundError } from "@insightview/core";
import { prisma } from "../client.js";
import type { ApiToken, Prisma } from "../generated/client/index.js";

/**
 * API token repository (ADR 0012). Tokens are never stored in
 * plaintext — only their SHA-256 hash lives in the DB. The raw
 * token is returned ONCE at mint time; losing it means mint a
 * new one.
 *
 * Role values (convention, not enforced here):
 *   admin — full access including token mint
 *   write — monitors CRUD, alert rules, ingest
 *   read  — list/get only
 *
 * Scopes are free-form strings the API layer interprets
 * (e.g. "monitors:deploy", "runs:trigger", "alerts:read").
 */

export interface MintTokenInput {
  name: string;
  role?: "admin" | "write" | "read";
  scopes?: string[];
  expiresAt?: Date;
}

export interface MintTokenResult {
  id: string;
  raw: string;
  role: string;
  scopes: string[];
  expiresAt: Date | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function mintToken(
  ctx: TenantContext,
  input: MintTokenInput,
): Promise<MintTokenResult> {
  const raw = `iv_${randomBytes(24).toString("hex")}`;
  const tokenHash = hashToken(raw);
  const row = await prisma.apiToken.create({
    data: {
      tenantId: ctx.tenantId,
      name: input.name,
      tokenHash,
      role: input.role ?? "read",
      scopes: input.scopes ?? [],
      expiresAt: input.expiresAt ?? null,
    },
  });
  return {
    id: row.id,
    raw,
    role: row.role,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
  };
}

export interface VerifiedToken {
  id: string;
  tenantId: string;
  role: string;
  scopes: string[];
  name: string;
}

export async function verifyToken(
  raw: string,
): Promise<VerifiedToken | null> {
  if (!raw) return null;
  const tokenHash = hashToken(raw);
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  // Bump lastUsedAt (fire-and-forget so it doesn't block the request).
  void prisma.apiToken
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});
  return {
    id: row.id,
    tenantId: row.tenantId,
    role: row.role,
    scopes: row.scopes,
    name: row.name,
  };
}

export async function revokeToken(
  ctx: TenantContext,
  id: string,
): Promise<ApiToken> {
  const row = await prisma.apiToken.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!row) throw new NotFoundError("ApiToken", id);
  return prisma.apiToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export async function listTokens(
  ctx: TenantContext,
): Promise<Array<Omit<ApiToken, "tokenHash">>> {
  const rows = await prisma.apiToken.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "desc" },
  });
  // Strip the hash from the response.
  return rows.map(({ tokenHash: _omit, ...rest }) => rest);
}
