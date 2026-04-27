import type { FastifyInstance } from "fastify";

export async function registerMetricsRoute(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", app.metricsRegistry.contentType);
    return app.metricsRegistry.metrics();
  });
}
