import { Registry, Gauge } from 'prom-client';
import type { MonitoringReport } from '../types';
import { TEST_METRIC_CATEGORIES } from '../constants';

const registry = new Registry();

const webVitalsGauge = new Gauge({
  name: 'synthetic_monitoring_web_vitals',
  help: 'Web Vitals metrics from synthetic monitoring',
  labelNames: ['metric', 'url', 'test_name', 'browser', 'device'],
  registers: [registry],
});

const testMetricsGauge = new Gauge({
  name: 'synthetic_monitoring_test_metrics',
  help: 'Test execution metrics from synthetic monitoring',
  labelNames: ['category', 'metric', 'test_name', 'browser', 'device', 'status'],
  registers: [registry],
});

export async function pushMetricsToPrometheus(report: MonitoringReport): Promise<void> {
  const { webVitals, testMetrics, environment } = report;
  const labels = {
    browser: environment.browser.name,
    device: environment.browser.device,
    test_name: testMetrics.name,
  };

  // Web Vitals metrics
  webVitals.metrics.forEach((metric) => {
    webVitalsGauge.set(
      { 
        ...labels,
        metric: metric.name,
        url: webVitals.url,
      },
      metric.value
    );
  });

  Object.entries(testMetrics).forEach(([category, metrics]) => {
    if (typeof metrics === 'object') {
      Object.entries(metrics).forEach(([metric, value]) => {
        if (typeof value === 'number') {
          testMetricsGauge.set(
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

  const pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY;
  if (!pushgatewayUrl) {
    throw new Error('PROMETHEUS_PUSHGATEWAY environment variable not set');
  }

  const metrics_data = await registry.metrics();
  await fetch(`${pushgatewayUrl}/metrics/job/synthetic_monitoring`, {
    method: 'POST',
    body: metrics_data,
  });
}