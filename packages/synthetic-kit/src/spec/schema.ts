import { z } from "zod";

/**
 * YAML schema for native-run monitors. This is a *superset* of the
 * platform's monitors-as-code schema — you can re-use the same YAML
 * files for both the platform and the Actions-native mode. Native-
 * specific fields (auth, network, exporters) live under spec.native.
 */

const AssertionSchema = z.object({
  type: z.string(),
  value: z.string(),
});

const StepSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  waitFor: z
    .object({
      selector: z.string().optional(),
      networkIdle: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .optional(),
  assertions: z.array(AssertionSchema).optional(),
});

const AuthSchema = z.object({
  strategy: z.enum([
    "none",
    "storage-state",
    "form-login",
    "totp",
    "oauth-client-credentials",
    "vault-oidc",
  ]),
  config: z.record(z.unknown()).default({}),
});

const NetworkSchema = z.object({
  profile: z.enum(["direct", "proxy", "mtls", "tailscale", "wireguard"]),
  config: z.record(z.unknown()).optional(),
});

const ExporterSchema = z.object({
  type: z.enum([
    "stdout",
    "pushgateway",
    "s3",
    "github-artifact",
    "healthchecks",
    "platform",
  ]),
  config: z.record(z.unknown()).optional(),
});

const CookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
});

const NativeSpecSchema = z.object({
  type: z.enum(["browser"]).default("browser"),
  enabled: z.boolean().optional(),
  schedule: z.string().optional(),
  targetUrl: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().min(0).optional(),
  scriptRef: z.string().optional(),
  assertions: z.array(AssertionSchema).optional(),
  tags: z.array(z.string()).optional(),
  steps: z.array(StepSchema).optional(),
  native: z
    .object({
      auth: AuthSchema.optional(),
      network: NetworkSchema.optional(),
      exporters: z.array(ExporterSchema).optional(),
      preCookies: z.array(CookieSchema).optional(),
      location: z.string().optional(),
    })
    .optional(),
});

export const MonitorDocSchema = z.object({
  apiVersion: z.literal("insightview.io/v1"),
  kind: z.literal("Check"),
  metadata: z.object({
    name: z.string().min(1).max(120),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  spec: NativeSpecSchema,
});

export type MonitorDoc = z.infer<typeof MonitorDocSchema>;
