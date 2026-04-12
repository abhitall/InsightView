import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createLogger } from "@insightview/observability";
import { registerEventRoutes } from "./routes/events.js";

const log = createLogger({ service: "rum-collector" });
const port = Number(process.env.PORT ?? 4400);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024,
  });

  await app.register(cors, { origin: true, credentials: false });
  await app.register(rateLimit, {
    max: Number(process.env.RUM_RATE_LIMIT ?? 600),
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      const siteId =
        ((req.body as { siteId?: string } | undefined)?.siteId as string) ?? "unknown";
      return `${siteId}:${req.ip}`;
    },
  });

  app.get("/healthz", async () => ({ ok: true, service: "rum-collector" }));

  await registerEventRoutes(app);

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
