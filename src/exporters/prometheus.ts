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

    try {
      // Clear previous metrics to prevent stale data
      this.registry.resetMetrics();
      
      // Handle single page or array of web vitals
      const webVitalsArray = Array.isArray(webVitals) ? webVitals : [webVitals];
      
      // Export Web Vitals metrics for each page
      webVitalsArray.forEach((pageWebVitals) => {
        if (pageWebVitals && Array.isArray(pageWebVitals.metrics)) {
          pageWebVitals.metrics.forEach((metric) => {
            if (metric && typeof metric.value === 'number') {
              console.log(`Setting web vital: ${metric.name}=${metric.value} for URL ${pageWebVitals.url}`);
              this.webVitalsGauge.set(
                { 
                  ...labels,
                  metric: metric.name,
                  url: pageWebVitals.url,
                },
                metric.value
              );
            }
          });
        } else {
          console.warn('Invalid web vitals data structure:', pageWebVitals);
        }
      });

      // Export test metrics
      Object.entries(testMetrics).forEach(([category, metrics]) => {
        if (typeof metrics === 'object' && metrics !== null) {
          Object.entries(metrics).forEach(([metric, value]) => {
            if (typeof value === 'number') {
              console.log(`Setting test metric: ${category}.${metric}=${value}`);
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
    } catch (error) {
      console.error('Error exporting metrics to Prometheus:', error);
      throw error;
    }
  }

  private async pushMetrics(): Promise<void> {
    const pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY;
    if (!pushgatewayUrl) {
      throw new Error('PROMETHEUS_PUSHGATEWAY environment variable not set');
    }

    console.log(`Pushing metrics to Prometheus Pushgateway at ${pushgatewayUrl}`);
    
    try {
      const metrics = await this.registry.metrics();
      console.log('Metrics payload size:', metrics.length, 'bytes');
      
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