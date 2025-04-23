import { Registry, Gauge } from 'prom-client';
import type { MonitoringReport } from '../types';

export class PrometheusExporter {
  private registry: Registry;
  private webVitalsGauge: Gauge;
  private testMetricsGauge: Gauge;
  private resourceMetricsGauge: Gauge;
  private actionRunId: string;

  constructor() {
    this.registry = new Registry();
    this.actionRunId = process.env.GITHUB_RUN_ID || `local_${Date.now()}`;
    
    this.webVitalsGauge = new Gauge({
      name: 'synthetic_monitoring_web_vitals',
      help: 'Web Vitals metrics from synthetic monitoring',
      labelNames: [
        'metric',
        'url',
        'test_id',
        'test_title',
        'page_index',
        'timestamp',
        'browser',
        'device',
        'action_run_id',
        'repository',
        'workflow'
      ],
      registers: [this.registry],
    });

    this.resourceMetricsGauge = new Gauge({
      name: 'synthetic_monitoring_resource_metrics',
      help: 'Resource timing metrics from synthetic monitoring',
      labelNames: ['metric', 'url', 'resource_type', 'test_name', 'browser', 'device', 'page_url'],
      registers: [this.registry],
    });

    this.testMetricsGauge = new Gauge({
      name: 'synthetic_monitoring_test_metrics',
      help: 'Test execution metrics from synthetic monitoring',
      labelNames: [
        'metric',
        'url',
        'test_id',
        'test_title',
        'timestamp',
        'browser',
        'device',
        'status',
        'action_run_id',
        'repository',
        'workflow'
      ],
      registers: [this.registry],
    });
  }

  async export(report: MonitoringReport): Promise<void> {
    const { webVitals, testMetrics, environment } = report;
    const baseLabels = {
      browser: environment.browser.name,
      device: environment.browser.device,
      action_run_id: this.actionRunId,
      repository: process.env.GITHUB_REPOSITORY || 'local',
      workflow: process.env.GITHUB_WORKFLOW || 'local'
    };

    try {
      // Clear previous metrics to prevent stale data
      this.registry.resetMetrics();
      
      // Export Web Vitals metrics
      for (const pageMetrics of webVitals) {
        for (const metric of pageMetrics.metrics) {
          const sanitizedTitle = metric.labels.testTitle.replace(/[^a-zA-Z0-9_]/g, '_');
          const labels = {
            ...baseLabels,
            metric: metric.name,
            url: metric.labels.url,
            test_id: metric.labels.testId,
            test_title: sanitizedTitle,
            page_index: String(metric.labels.pageIndex),
            timestamp: String(metric.labels.timestamp),
          };

          console.log(`Setting web vital metric: ${metric.name} with labels:`, labels);
          this.webVitalsGauge.set(labels, metric.value);
        }
      }

      // Export Test Metrics
      const sanitizedTitle = testMetrics.labels.testTitle.replace(/[^a-zA-Z0-9_]/g, '_');
      const testLabels = {
        ...baseLabels,
        metric: 'duration',
        url: testMetrics.labels.url,
        test_id: testMetrics.labels.testId,
        test_title: sanitizedTitle,
        timestamp: String(testMetrics.labels.timestamp),
        status: testMetrics.status,
      };

      console.log('Setting test metric with labels:', testLabels);
      this.testMetricsGauge.set(testLabels, testMetrics.duration);

      await this.pushMetrics();
    } catch (error) {
      console.error('Error exporting metrics to Prometheus:', error);
      throw error;
    }
  }

  private getPageType(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      
      if (pathParts.length === 0) return 'homepage';
      if (pathParts.length === 1) return pathParts[0];
      return pathParts.join('_');
    } catch (e) {
      return 'unknown';
    }
  }

  private async pushMetrics(): Promise<void> {
    const pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY;
    if (!pushgatewayUrl) {
      throw new Error('PROMETHEUS_PUSHGATEWAY environment variable not set');
    }

    try {
      const metrics = await this.registry.metrics();
      console.log('Raw metrics being pushed to Prometheus:');
      console.log(metrics);
      
      const response = await fetch(`${pushgatewayUrl}/metrics/job/synthetic_monitoring`, {
        method: 'POST',
        body: metrics,
        headers: {
          'Content-Type': 'text/plain',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to push metrics to Pushgateway: ${response.status} ${response.statusText}\n${errorText}`);
      }
      
      console.log('Successfully pushed metrics to Prometheus Pushgateway');
    } catch (error) {
      console.error('Error pushing metrics to Prometheus Pushgateway:', error);
      throw error;
    }
  }
}