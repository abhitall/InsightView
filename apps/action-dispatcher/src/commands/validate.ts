import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import { z } from "zod";

const AssertionSchema = z.object({ type: z.string(), value: z.string() });

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
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const DocSchema = z.discriminatedUnion("kind", [
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

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ya?ml)$/i.test(entry)) out.push(full);
  }
  return out;
}

export async function validateCommand(_args: string[]): Promise<number> {
  const monitorsPath = process.env.INSIGHTVIEW_MONITORS_PATH ?? "monitors";
  let files: string[];
  try {
    files = walk(monitorsPath);
  } catch (err) {
    console.error(
      `Failed to read monitors directory '${monitorsPath}':`,
      (err as Error).message,
    );
    return 1;
  }

  let errors = 0;
  let docs = 0;
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const parsed = parseAllDocuments(content);
    for (let i = 0; i < parsed.length; i++) {
      const doc = parsed[i];
      const line = 1;
      if (doc.errors.length > 0) {
        console.error(
          `::error file=${file},line=${line}::YAML parse error: ${doc.errors.map((e) => e.message).join("; ")}`,
        );
        errors++;
        continue;
      }
      const json = doc.toJS();
      if (!json) continue;
      const result = DocSchema.safeParse(json);
      if (!result.success) {
        const issue = result.error.issues[0];
        console.error(
          `::error file=${file},line=${line}::${issue?.path.join(".")} ${issue?.message}`,
        );
        errors++;
        continue;
      }
      docs++;
      console.log(`✓ ${file} doc#${i} kind=${result.data.kind}`);
    }
  }

  if (errors > 0) {
    console.error(`Validation failed: ${errors} error(s) across ${files.length} file(s)`);
    return 1;
  }
  console.log(`Validation passed: ${docs} doc(s) across ${files.length} file(s)`);
  return 0;
}
