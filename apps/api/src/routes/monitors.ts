import type { FastifyInstance } from "fastify";
import { parseMonitorsYaml, applyMonitors } from "../services/monitorsYaml.js";

export async function registerMonitorRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post<{ Body: { yaml: string; actor?: string; source?: string } }>(
    "/v1/monitors/apply",
    async (req) => {
      const body = req.body;
      const parsed = parseMonitorsYaml(body.yaml);
      const result = await applyMonitors(req.tenant, parsed, {
        actor: body.actor ?? "api",
        source: (body.source ?? "API") as "ACTION" | "API" | "CLI",
        yaml: body.yaml,
      });
      return result;
    },
  );

  app.post<{ Body: { yaml: string } }>("/v1/monitors/validate", async (req) => {
    const parsed = parseMonitorsYaml(req.body.yaml);
    return { valid: true, count: parsed.length, docs: parsed };
  });
}
