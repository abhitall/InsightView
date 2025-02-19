import { Registry, Gauge } from 'prom-client';
import type { MonitoringReport } from '../types';

export class PrometheusExporter {
  private registry: Registry;
  private webVitalsGauge: Gauge;
  private testMetricsGauge: Gauge;
  private securityMetricsGauge: Gauge;

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

    this.securityMetricsGauge = new Gauge({
      name: 'synthetic_monitoring_security_metrics',
      help: 'Security scan metrics from ZAP',
      labelNames: ['severity', 'url'],
      registers: [this.registry],
    });
  }

  async export(report: MonitoringReport): Promise<void> {
    const { webVitals, testMetrics, securityScan, environment } = report;
    const labels = {
      browser: environment.browser.name,
      device: environment.browser.device,
      test_name: testMetrics.name,
    };

    // Handle single page or array of web vitals
    const webVitalsArray = Array.isArray(webVitals) ? webVitals : [webVitals];
    
    // Export Web Vitals metrics for each page
    webVitalsArray.forEach((pageWebVitals) => {
      pageWebVitals.metrics.forEach((metric) => {
        this.webVitalsGauge.set(
          { 
            ...labels,
            metric: metric.name,
            url: pageWebVitals.url,
          },
          metric.value
        );
      });
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

    // Export security metrics if available
    if (securityScan) {
      this.securityMetricsGauge.set(
        { severity: 'high', url: securityScan.targetUrl },
        securityScan.summary.high
      );
      this.securityMetricsGauge.set(
        { severity: 'medium', url: securityScan.targetUrl },
        securityScan.summary.medium
      );
      this.securityMetricsGauge.set(
        { severity: 'low', url: securityScan.targetUrl },
        securityScan.summary.low
      );
      this.securityMetricsGauge.set(
        { severity: 'info', url: securityScan.targetUrl },
        securityScan.summary.info
      );
    }

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