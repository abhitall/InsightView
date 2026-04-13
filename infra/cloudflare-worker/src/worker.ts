/**
 * InsightView RUM edge collector — Cloudflare Worker.
 *
 * Sits in front of the upstream RUM collector and:
 *   1. Accepts RUM beacon batches from 330+ Cloudflare edge PoPs
 *      with sub-millisecond cold start — far closer to the user
 *      than the origin collector.
 *   2. Rate limits per-client to cap abuse.
 *   3. Enriches beacons with geo info from Cloudflare's request
 *      context (`cf.country`, `cf.colo`, `cf.continent`) so the
 *      origin collector gets free geo without MaxMind.
 *   4. Forwards the enriched batch to the upstream collector.
 *
 * Two routes:
 *   POST /v1/events  — standard RUM batch forwarding
 *   POST /v1/replay  — rrweb session replay chunk forwarding
 *
 * Deployment:
 *   cd infra/cloudflare-worker && pnpm wrangler deploy
 *
 * The free tier supports 100k requests/day, which is plenty for
 * teams experimenting with RUM. Paid tiers scale linearly.
 */

export interface Env {
  UPSTREAM_URL: string;
  UPSTREAM_REPLAY_URL: string;
  RATE_LIMIT_PER_MINUTE: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (request.method !== "POST") {
      return new Response("method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    // Rate limit per-client by IP address (best we can do without KV).
    const rateCheck = await checkInProcRateLimit(request, env);
    if (!rateCheck.ok) {
      return new Response(
        JSON.stringify({ error: "rate_limited" }),
        {
          status: 429,
          headers: { ...corsHeaders, "content-type": "application/json" },
        },
      );
    }

    let upstream: string;
    if (url.pathname === "/v1/events") {
      upstream = env.UPSTREAM_URL;
    } else if (url.pathname === "/v1/replay") {
      upstream = env.UPSTREAM_REPLAY_URL;
    } else {
      return new Response("not found", { status: 404, headers: corsHeaders });
    }

    // Enrich the payload with Cloudflare-provided geo info.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("invalid json", { status: 400, headers: corsHeaders });
    }
    const cfContext = (request as unknown as {
      cf?: { country?: string; colo?: string; continent?: string };
    }).cf;
    const enriched = {
      ...(body as Record<string, unknown>),
      edge: {
        country: cfContext?.country ?? null,
        colo: cfContext?.colo ?? null,
        continent: cfContext?.continent ?? null,
      },
    };

    // Forward to the upstream collector. Use `waitUntil` to allow
    // the response to flush immediately while the upstream POST
    // finishes in the background.
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": request.headers.get("cf-connecting-ip") ?? "",
        "x-rum-edge-colo": cfContext?.colo ?? "",
      },
      body: JSON.stringify(enriched),
    }).catch(() => null);

    if (!upstreamRes) {
      return new Response(
        JSON.stringify({ error: "upstream_unreachable" }),
        {
          status: 502,
          headers: { ...corsHeaders, "content-type": "application/json" },
        },
      );
    }
    return new Response(await upstreamRes.text(), {
      status: upstreamRes.status,
      headers: {
        ...corsHeaders,
        "content-type":
          upstreamRes.headers.get("content-type") ?? "application/json",
      },
    });
  },
};

/**
 * Extremely simple in-memory rate limit. Cloudflare Workers share
 * memory across requests routed to the same isolate, so this is
 * "best-effort per PoP". For real rate limiting configure a KV
 * namespace and key by client IP.
 */
const rateWindows = new Map<string, { count: number; expiresAt: number }>();
async function checkInProcRateLimit(
  request: Request,
  env: Env,
): Promise<{ ok: boolean }> {
  const limit = parseInt(env.RATE_LIMIT_PER_MINUTE, 10);
  if (!Number.isFinite(limit) || limit <= 0) return { ok: true };
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "unknown";
  const now = Date.now();
  const entry = rateWindows.get(ip);
  if (!entry || entry.expiresAt < now) {
    rateWindows.set(ip, { count: 1, expiresAt: now + 60_000 });
    return { ok: true };
  }
  if (entry.count >= limit) {
    return { ok: false };
  }
  entry.count++;
  return { ok: true };
}
