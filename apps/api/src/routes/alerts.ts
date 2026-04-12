import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listAlertRules,
  upsertAlertRule,
  listIncidents,
  listChannels,
  upsertChannel,
} from "@insightview/db";
import { AlertStrategy, Severity, NotificationChannelType } from "@insightview/core";

const RuleBody = z.object({
  name: z.string().min(1),
  checkId: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
  strategy: z.nativeEnum(AlertStrategy),
  expression: z.record(z.unknown()).default({}),
  severity: z.nativeEnum(Severity),
  cooldownSeconds: z.number().int().positive().optional(),
  channelIds: z.array(z.string()).optional(),
});

const ChannelBody = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(NotificationChannelType),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export async function registerAlertRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/v1/alert-rules", async (req) => ({
    items: await listAlertRules(req.tenant),
  }));

  app.post("/v1/alert-rules", async (req, reply) => {
    const body = RuleBody.parse(req.body);
    const rule = await upsertAlertRule(req.tenant, body);
    reply.status(201);
    return rule;
  });

  app.get("/v1/incidents", async (req) => ({
    items: await listIncidents(req.tenant, 100),
  }));

  app.get("/v1/channels", async (req) => ({
    items: await listChannels(req.tenant),
  }));

  app.post("/v1/channels", async (req, reply) => {
    const body = ChannelBody.parse(req.body);
    const channel = await upsertChannel(req.tenant, body);
    reply.status(201);
    return channel;
  });
}
