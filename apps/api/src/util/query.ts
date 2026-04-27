/**
 * Parse a `limit` querystring value into a clamped integer. Returns
 * `defaultLimit` when the value is missing, NaN, or out of range.
 * Bounds default to 1..1000 — callers can override per route if a
 * tighter ceiling is appropriate (e.g. heavy joins).
 */
export function parseLimit(
  raw: string | undefined,
  defaultLimit = 100,
  minLimit = 1,
  maxLimit = 1000,
): number {
  if (raw === undefined || raw === "") return defaultLimit;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultLimit;
  if (n < minLimit) return minLimit;
  if (n > maxLimit) return maxLimit;
  return n;
}
