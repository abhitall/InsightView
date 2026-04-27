import type { ResultEnvelope } from "../types.js";
import { stdoutExporter } from "./stdout.js";
import { pushgatewayExporter } from "./pushgateway.js";
import { s3Exporter } from "./s3.js";
import { githubArtifactExporter } from "./githubArtifact.js";
import { healthchecksExporter } from "./healthchecks.js";
import { platformExporter } from "./platform.js";

/**
 * Exporter strategy. Each exporter takes a ResultEnvelope and ships
 * it somewhere (time-series DB, object store, bridging REST API,
 * dead-man's-switch ping). Exporters MUST NOT throw on transient
 * failures — they log and move on so the overall run still reports
 * the metrics it collected.
 */
export interface Exporter {
  readonly name: string;
  export(
    envelope: ResultEnvelope,
    config: Record<string, unknown>,
  ): Promise<void>;
}

const registry = new Map<string, Exporter>();

export function registerExporter(exporter: Exporter): void {
  registry.set(exporter.name, exporter);
}

export function exporterFor(name: string): Exporter {
  const e = registry.get(name);
  if (!e) {
    throw new Error(
      `Unknown exporter '${name}'. Registered: ${[...registry.keys()].join(", ")}`,
    );
  }
  return e;
}

registerExporter(stdoutExporter);
registerExporter(pushgatewayExporter);
registerExporter(s3Exporter);
registerExporter(githubArtifactExporter);
registerExporter(healthchecksExporter);
registerExporter(platformExporter);
