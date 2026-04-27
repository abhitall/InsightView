import type { FastifyInstance } from "fastify";
import { listResultsByRun } from "@insightview/db";

export async function registerResultRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Params: { runId: string } }>(
    "/v1/runs/:runId/results",
    async (req) => {
      const items = await listResultsByRun(req.tenant, req.params.runId);
      return { items };
    },
  );
}
