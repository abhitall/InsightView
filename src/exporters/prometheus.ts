import { Registry, Gauge } from 'prom-client';
import type { MonitoringReport } from '../types';

export class PrometheusExporter {
  private registry: Registry;
  private webVitalsGauge: Gauge;
  private testMetricsGauge: Gauge;

  constructor() {
    this.registry = new Registry();
    
    this.webVitalsGauge = new Gauge({
      name: 'synthetic_monitoring_web_vitals',
      help: 'Web Vitals metrics from synthetic monitoring',
      labelNames: ['metric', 'url', 'test_name', 'browser', 'device'],
      registers: [this.registry],
    });

    this.testMetricsGauge = new Gauge({
      name: 'synthetic_monitoring_test_metrics',
      help: 'Test execution metrics from synthetic monitoring',
      labelNames: ['category', 'metric', 'test_name', 'browser', 'device', 'status'],
      registers: [this.registry],
    });
  }

  async export(report: MonitoringReport): Promise<void> {
    const { webVitals, testMetrics, environment } = report;
    const labels = {
      browser: environment.browser.name,
      device: environment.browser.device,
      test_name: testMetrics.name,
    };

    // Export Web Vitals metrics
    webVitals.metrics.forEach((metric) => {
      this.webVitalsGauge.set(
        { 
          ...labels,
          metric: metric.name,
          url: webVitals.url,
        },
        metric.value
      );
    });

    // Export test metrics
    Object.entries(testMetrics).forEach(([category, metrics]) => {
      if (typeof metrics === 'object') {
        Object.entries(metrics).forEach(([metric, value]) => {
          if (typeof value === 'number') {
            this.testMetricsGauge.set(
              {
                ...labels,
                category,
                metric,
                status: testMetrics.status,
              },
              value
            );
          }
        });
      }
    });

    await this.pushMetrics();
  }

  private async pushMetrics(): Promise<void> {
    const pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY;
    if (!pushgatewayUrl) {
      throw new Error('PROMETHEUS_PUSHGATEWAY environment variable not set');
    }

    const metrics = await this.registry.metrics();
    await fetch(`${pushgatewayUrl}/metrics/job/synthetic_monitoring`, {
      method: 'POST',
      body: metrics,
    });
  }
}