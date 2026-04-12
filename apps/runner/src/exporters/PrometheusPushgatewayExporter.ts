import { Registry, Gauge } from "prom-client";
import type { CheckRunStatus } from "@insightview/core";

/**
 * Thin Pushgateway exporter that publishes the same family of metrics
 * the legacy exporter used (prefix `synthetic_monitoring_*`). The
 * legacy code still runs when the action's `legacy-run` command is
 * invoked; this class is the platform-side mirror so dashboards keep
 * their PromQL working.
 */
export class PrometheusPushgatewayExporter {
  private readonly registry = new Registry();
  private readonly webVitalsGauge: Gauge<string>;
  private readonly durationGauge: Gauge<string>;
  private readonly statusGauge: Gauge<string>;
  private readonly pushgatewayUrl: string | undefined;

  constructor() {
    this.pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY;
    this.webVitalsGauge = new Gauge({
      name: "synthetic_monitoring_web_vitals",
      help: "Web Vitals metrics from synthetic monitoring",
      labelNames: ["metric", "check_name", "run_id", "status"],
      registers: [this.registry],
    });
    this.durationGauge = new Gauge({
      name: "synthetic_monitoring_duration_ms",
      help: "Run duration in milliseconds",
      labelNames: ["check_name", "run_id", "status"],
      registers: [this.registry],
    });
    this.statusGauge = new Gauge({
      name: "synthetic_monitoring_status",
      help: "1 if the run passed, 0 otherwise",
      labelNames: ["check_name", "run_id", "status"],
      registers: [this.registry],
    });
  }

  async export(input: {
    checkName: string;
    runId: string;
    status: CheckRunStatus;
    webVitals: Record<string, number>;
    durationMs: number;
  }): Promise<void> {
    if (!this.pushgatewayUrl) return;
    this.registry.resetMetrics();

    const labels = {
      check_name: input.checkName,
      run_id: input.runId,
      status: input.status,
    };
    for (const [metric, value] of Object.entries(input.webVitals)) {
      this.webVitalsGauge.set({ ...labels, metric }, value);
    }
    this.durationGauge.set(labels, input.durationMs);
    this.statusGauge.set(labels, input.status === "PASSED" ? 1 : 0);

    const metrics = await this.registry.metrics();
    const url = `${this.pushgatewayUrl.replace(/\/$/, "")}/metrics/job/insightview_synthetic/check/${encodeURIComponent(input.checkName)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: metrics,
    });
    if (!res.ok) {
      throw new Error(`Pushgateway POST failed: ${res.status} ${res.statusText}`);
    }
  }
}
