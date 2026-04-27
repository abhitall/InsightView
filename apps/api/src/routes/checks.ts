import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listChecks,
  getCheckByName,
  upsertCheck,
  deleteCheck,
  type CheckInput,
} from "@insightview/db";

const AssertionSchema = z.object({
  type: z.string(),
  value: z.string(),
});

const CheckBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional().nullable(),
  type: z.enum(["BROWSER", "API", "TCP"]).optional(),
  enabled: z.boolean().optional(),
  schedule: z.string().min(1),
  targetUrl: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().min(0).optional(),
  locations: z.array(z.string()).optional(),
  scriptRef: z.string().optional().nullable(),
  assertions: z.array(AssertionSchema).optional(),
  tags: z.array(z.string()).optional(),
});

export async function registerCheckRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/v1/checks", async (req) => {
    const checks = await listChecks(req.tenant);
    return { items: checks };
  });

  app.get<{ Params: { name: string } }>(
    "/v1/checks/:name",
    async (req) => {
      const check = await getCheckByName(req.tenant, req.params.name);
      return check;
    },
  );

  app.post("/v1/checks", async (req, reply) => {
    const body = CheckBodySchema.parse(req.body);
    const check = await upsertCheck(req.tenant, body as CheckInput);
    reply.status(201);
    return check;
  });

  app.put<{ Params: { name: string } }>(
    "/v1/checks/:name",
    async (req) => {
      const body = CheckBodySchema.parse(req.body);
      return upsertCheck(req.tenant, { ...body, name: req.params.name } as CheckInput);
    },
  );

  app.delete<{ Params: { name: string } }>(
    "/v1/checks/:name",
    async (req, reply) => {
      const check = await getCheckByName(req.tenant, req.params.name);
      await deleteCheck(req.tenant, check.id);
      reply.status(204);
    },
  );
}
