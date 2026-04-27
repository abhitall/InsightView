import { createHash } from "node:crypto";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { ValidationError, type TenantContext } from "@insightview/core";
import {
  upsertCheck,
  upsertAlertRule,
  recordDeployment,
  findCheckByName,
  type CheckInput,
} from "@insightview/db";

const AssertionSchema = z.object({
  type: z.string(),
  value: z.string(),
});

const CheckSpecSchema = z.object({
  type: z.enum(["browser", "api", "tcp"]).default("browser"),
  enabled: z.boolean().optional(),
  schedule: z.string(),
  targetUrl: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().min(0).optional(),
  locations: z.array(z.string()).optional(),
  scriptRef: z.string().optional(),
  assertions: z.array(AssertionSchema).optional(),
  tags: z.array(z.string()).optional(),
});

const AlertRuleSpecSchema = z.object({
  checkName: z.string().optional(),
  enabled: z.boolean().optional(),
  strategy: z.enum(["THRESHOLD", "CONSECUTIVE_FAILURES", "COMPOSITE"]),
  expression: z.record(z.unknown()).default({}),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  cooldownSeconds: z.number().int().positive().optional(),
  channels: z.array(z.string()).optional(),
});

const MetadataSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const MonitorDocSchema = z.discriminatedUnion("kind", [
  z.object({
    apiVersion: z.literal("insightview.io/v1"),
    kind: z.literal("Check"),
    metadata: MetadataSchema,
    spec: CheckSpecSchema,
  }),
  z.object({
    apiVersion: z.literal("insightview.io/v1"),
    kind: z.literal("AlertRule"),
    metadata: MetadataSchema,
    spec: AlertRuleSpecSchema,
  }),
]);

export type MonitorDoc = z.infer<typeof MonitorDocSchema>;

export function parseMonitorsYaml(yaml: string): MonitorDoc[] {
  const docs = parseAllDocuments(yaml);
  const out: MonitorDoc[] = [];
  for (const doc of docs) {
    if (doc.errors.length > 0) {
      throw new ValidationError(
        `YAML parse error: ${doc.errors.map((e) => e.message).join("; ")}`,
      );
    }
    const json = doc.toJS();
    if (!json) continue;
    const result = MonitorDocSchema.safeParse(json);
    if (!result.success) {
      throw new ValidationError("Monitor document failed schema validation", {
        issues: result.error.issues,
        received: json,
      });
    }
    out.push(result.data);
  }
  return out;
}

export interface ApplyOptions {
  actor: string;
  source: "ACTION" | "API" | "CLI";
  yaml: string;
}

export async function applyMonitors(
  ctx: TenantContext,
  docs: MonitorDoc[],
  opts: ApplyOptions,
): Promise<{
  appliedChecks: string[];
  appliedRules: string[];
  deploymentId: string;
}> {
  const yamlHash = createHash("sha256").update(opts.yaml).digest("hex");
  const appliedChecks: string[] = [];
  const appliedRules: string[] = [];

  // Two-pass so rules can reference checks that were applied in the same file.
  for (const doc of docs) {
    if (doc.kind === "Check") {
      const input: CheckInput = {
        name: doc.metadata.name,
        description: doc.metadata.description ?? null,
        type: doc.spec.type.toUpperCase() as "BROWSER" | "API" | "TCP",
        enabled: doc.spec.enabled ?? true,
        schedule: doc.spec.schedule,
        targetUrl: doc.spec.targetUrl,
        timeoutMs: doc.spec.timeoutMs,
        retries: doc.spec.retries,
        locations: doc.spec.locations,
        scriptRef: doc.spec.scriptRef,
        assertions: doc.spec.assertions ?? [],
        tags: doc.metadata.tags ?? doc.spec.tags ?? [],
        sourceYaml: opts.yaml,
        sourceYamlHash: yamlHash,
      };
      await upsertCheck(ctx, input);
      appliedChecks.push(doc.metadata.name);
    }
  }

  for (const doc of docs) {
    if (doc.kind === "AlertRule") {
      let checkId: string | null = null;
      if (doc.spec.checkName) {
        const c = await findCheckByName(ctx, doc.spec.checkName);
        checkId = c?.id ?? null;
      }
      await upsertAlertRule(ctx, {
        name: doc.metadata.name,
        checkId,
        enabled: doc.spec.enabled ?? true,
        strategy: doc.spec.strategy,
        expression: doc.spec.expression,
        severity: doc.spec.severity,
        cooldownSeconds: doc.spec.cooldownSeconds,
        channelIds: doc.spec.channels,
      });
      appliedRules.push(doc.metadata.name);
    }
  }

  const deployment = await recordDeployment(ctx, {
    actor: opts.actor,
    source: opts.source,
    yamlHash,
    diff: { appliedChecks, appliedRules },
  });

  return {
    appliedChecks,
    appliedRules,
    deploymentId: deployment.id,
  };
}
