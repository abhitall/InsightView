import geoip from "geoip-lite";

/**
 * Best-effort geo-IP lookup (ADR 0012 / Phase 3 feature).
 *
 * `geoip-lite` ships an offline MaxMind GeoLite2 country snapshot
 * with the npm package so no external API call is required and
 * no license file is needed for country-level resolution. For
 * city-level accuracy, production deployments should subscribe to
 * the MaxMind service and refresh the bundled database monthly
 * via `geoip-lite-update`.
 *
 * Trust order for the client IP:
 *   1. Cloudflare-style header `cf-connecting-ip` (worker edge)
 *   2. Standard `x-forwarded-for` (first hop)
 *   3. The raw `request.ip` from Fastify
 */

export interface GeoResult {
  country: string | null;
  region: string | null;
  city: string | null;
}

export function resolveGeo(
  headers: Record<string, string | string[] | undefined>,
  fallbackIp: string,
): GeoResult {
  const raw =
    firstHeader(headers["cf-connecting-ip"]) ??
    firstHeader(headers["x-forwarded-for"])?.split(",")[0]?.trim() ??
    fallbackIp;
  if (!raw) return { country: null, region: null, city: null };
  try {
    const lookup = geoip.lookup(raw);
    if (!lookup) return { country: null, region: null, city: null };
    return {
      country: lookup.country ?? null,
      region: (lookup.region as unknown as string) ?? null,
      city: lookup.city ?? null,
    };
  } catch {
    return { country: null, region: null, city: null };
  }
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
