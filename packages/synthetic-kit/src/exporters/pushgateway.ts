import { Registry, Gauge } from "prom-client";
import type { Exporter } from "./index.js";

/**
 * Prometheus Pushgateway exporter. Emits the same metric names as the
 * legacy v1 runner (`synthetic_monitoring_*`) so existing dashboards
 * and alert rules keep working even after the migration to the
 * Actions-native mode. Also emits new web-vitals and navigation-
 * timing metrics keyed by monitor name and GitHub run context.
 */
export const pushgatewayExporter: Exporter = {
  name: "pushgateway",
  async export(envelope, config) {
    const url =
      (config.url as string) ?? process.env.PROMETHEUS_PUSHGATEWAY;
    if (!url) {
      console.warn("[pushgateway] no url configured; skipping");
      return;
    }
    const job = (config.job as string) ?? "insightview_native";
    const registry = new Registry();

    const commonLabels = [
      "monitor",
      "status",
      "run_id",
      "location",
      "repository",
      "workflow",
    ] as const;
    type LabelNames = (typeof commonLabels)[number];

    const webVitalGauge = new Gauge<LabelNames | "metric">({
      name: "synthetic_monitoring_web_vitals",
      help: "Web Vitals from synthetic monitoring",
      labelNames: [...commonLabels, "metric"],
      registers: [registry],
    });
    const durationGauge = new Gauge<LabelNames>({
      name: "synthetic_monitoring_duration_ms",
      help: "Total run duration in milliseconds",
      labelNames: [...commonLabels],
      registers: [registry],
    });
    const statusGauge = new Gauge<LabelNames>({
      name: "synthetic_monitoring_status",
      help: "1 if the run passed, 0 otherwise",
      labelNames: [...commonLabels],
      registers: [registry],
    });
    const assertionGauge = new Gauge<LabelNames | "outcome">({
      name: "synthetic_monitoring_assertions",
      help: "Assertion counts",
      labelNames: [...commonLabels, "outcome"],
      registers: [registry],
    });

    const labels = {
      monitor: envelope.monitor,
      status: envelope.status,
      run_id: envelope.runId,
      location: envelope.location,
      repository: envelope.githubContext?.repository ?? "local",
      workflow: envelope.githubContext?.workflow ?? "local",
    };

    for (const [name, value] of Object.entries(envelope.summary.webVitals)) {
      if (typeof value === "number") {
        webVitalGauge.set({ ...labels, metric: name }, value);
      }
    }
    durationGauge.set(labels, envelope.durationMs);
    statusGauge.set(labels, envelope.status === "PASSED" ? 1 : 0);
    assertionGauge.set(
      { ...labels, outcome: "passed" },
      envelope.summary.passedAssertions,
    );
    assertionGauge.set(
      { ...labels, outcome: "failed" },
      envelope.summary.failedAssertions,
    );

    const body = await registry.metrics();
    const target = `${url.replace(/\/$/, "")}/metrics/job/${encodeURIComponent(
      job,
    )}/monitor/${encodeURIComponent(envelope.monitor)}`;
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
      });
      if (!res.ok) {
        console.warn(
          `[pushgateway] POST failed: ${res.status} ${res.statusText}`,
        );
      }
    } catch (err) {
      console.warn(`[pushgateway] unreachable: ${(err as Error).message}`);
    }
  },
};
