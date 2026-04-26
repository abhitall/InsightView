import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createLogger, createRegistry } from "@insightview/observability";
import { registerEventRoutes } from "./routes/events.js";
import { registerReplayRoutes } from "./routes/replay.js";

const log = createLogger({ service: "rum-collector" });
const port = Number(process.env.PORT ?? 4400);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024,
  });

  // navigator.sendBeacon can only send a CORS-safelisted Content-Type
  // (text/plain, application/x-www-form-urlencoded, multipart/form-data).
  // The browser SDK therefore sends the JSON body as `text/plain` to
  // avoid the preflight that sendBeacon cannot perform. Parse it as
  // JSON here so route handlers see the same shape either way.
  app.addContentTypeParser(
    "text/plain",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(cors, { origin: true, credentials: false });
  // Rate-limit key includes tenantId (when an `x-tenant-id` header
  // is present, e.g. set by the edge collector) so a noisy tenant
  // can't exhaust quota for other tenants on the same siteId.
  await app.register(rateLimit, {
    max: Number(process.env.RUM_RATE_LIMIT ?? 600),
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      const body = req.body as { siteId?: string } | undefined;
      const siteId = (body?.siteId as string) ?? "unknown";
      const tenantId =
        (req.headers["x-tenant-id"] as string | undefined) ?? "default";
      return `${tenantId}:${siteId}:${req.ip}`;
    },
  });

  app.get("/healthz", async () => ({ ok: true, service: "rum-collector" }));
  const registry = createRegistry("rum-collector");
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", registry.contentType);
    return registry.metrics();
  });

  await registerEventRoutes(app);
  await registerReplayRoutes(app);

  try {
    await app.listen({ port, host });
    log.info({ port }, "rum-collector listening");
  } catch (err) {
    log.error({ err }, "rum-collector failed to start");
    process.exit(1);
  }

  const shutdown = async () => {
    log.info("rum-collector shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  log.error({ err }, "fatal error in rum-collector");
  process.exit(1);
});
