import type { FastifyInstance } from "fastify";
import { prisma, isHeartbeatStale } from "@insightview/db";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async () => {
    let dbOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const watchdog = await isHeartbeatStale("scheduler-leader").catch(() => ({
      stale: true,
      ageMs: null,
    }));
    return {
      ok: dbOk,
      db: dbOk,
      watchdog: {
        stale: watchdog.stale,
        ageMs: watchdog.ageMs,
      },
      service: "api",
      uptime: process.uptime(),
    };
  });

  app.get("/readyz", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ready: true };
    } catch (err) {
      reply.status(503);
      return { ready: false, error: (err as Error).message };
    }
  });
}
