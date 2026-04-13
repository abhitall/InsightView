import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { DomainError, NotFoundError, ValidationError } from "@insightview/core";
import { registerHealthRoutes } from "./routes/health.js";
import { registerCheckRoutes } from "./routes/checks.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerResultRoutes } from "./routes/results.js";
import { registerAlertRoutes } from "./routes/alerts.js";
import { registerRumRoutes } from "./routes/rum.js";
import { registerMonitorRoutes } from "./routes/monitors.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerSourceMapRoutes } from "./routes/sourceMaps.js";
import { tenantPlugin } from "./plugins/tenant.js";
import { createRegistry } from "@insightview/observability";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(sensible);

  const registry = createRegistry("api");
  app.decorate("metricsRegistry", registry);

  await tenantPlugin(app);

  // Error mapping from domain errors to HTTP.
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof NotFoundError) {
      return reply.status(404).send({ error: err.code, message: err.message });
    }
    if (err instanceof ValidationError) {
      return reply.status(400).send({
        error: err.code,
        message: err.message,
        details: err.details,
      });
    }
    if (err instanceof DomainError) {
      return reply.status(400).send({ error: err.code, message: err.message });
    }
    const e = err as Error & { statusCode?: number };
    if (e.statusCode === 401) {
      return reply.status(401).send({ error: "UNAUTHORIZED", message: "Unauthorized" });
    }
    req.log.error({ err }, "Unhandled error");
    return reply.status(500).send({
      error: "INTERNAL",
      message: e.message ?? "Internal server error",
    });
  });

  await registerHealthRoutes(app);
  await registerMetricsRoute(app);
  await registerCheckRoutes(app);
  await registerRunRoutes(app);
  await registerResultRoutes(app);
  await registerAlertRoutes(app);
  await registerRumRoutes(app);
  await registerMonitorRoutes(app);
  await registerIngestRoutes(app);
  await registerSourceMapRoutes(app);

  return app;
}
