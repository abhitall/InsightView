import { Registry, Gauge } from 'prom-client';
import type { MonitoringReport } from '../types';

export class PrometheusExporter {
  private registry: Registry;
  private webVitalsGauge: Gauge;
  private testMetricsGauge: Gauge;
  private resourceMetricsGauge: Gauge;

  constructor() {
    this.registry = new Registry();
    
    this.webVitalsGauge = new Gauge({
      name: 'synthetic_monitoring_web_vitals',
      help: 'Web Vitals metrics from synthetic monitoring',
      labelNames: ['metric', 'url', 'test_name', 'browser', 'device', 'page_type'],
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
      labelNames: ['category', 'metric', 'test_name', 'browser', 'device', 'status', 'url'],
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
          // Determine page type from URL
          const pageType = this.getPageType(pageWebVitals.url);
          
          pageWebVitals.metrics.forEach((metric) => {
            if (metric && typeof metric.value === 'number') {
              console.log(`Setting web vital: ${metric.name}=${metric.value} for URL ${pageWebVitals.url}`);
              this.webVitalsGauge.set(
                { 
                  ...labels,
                  metric: metric.name,
                  url: pageWebVitals.url,
                  page_type: pageType,
                },
                metric.value
              );

              // If metric has resource timing data, export it separately
              if (metric.entries) {
                metric.entries.forEach((entry: any) => {
                  if (entry.name && entry.duration) {
                    console.log(`Setting resource metric: ${entry.name}=${entry.duration}`);
                    this.resourceMetricsGauge.set(
                      {
                        ...labels,
                        metric: 'duration',
                        url: entry.name,
                        resource_type: entry.entryType || 'unknown',
                        page_url: pageWebVitals.url,
                      },
                      entry.duration
                    );

                    // Export additional resource timing metrics if available
                    if (entry.startTime) {
                      this.resourceMetricsGauge.set(
                        {
                          ...labels,
                          metric: 'start_time',
                          url: entry.name,
                          resource_type: entry.entryType || 'unknown',
                          page_url: pageWebVitals.url,
                        },
                        entry.startTime
                      );
                    }

                    if (entry.responseEnd && entry.requestStart) {
                      this.resourceMetricsGauge.set(
                        {
                          ...labels,
                          metric: 'ttfb',
                          url: entry.name,
                          resource_type: entry.entryType || 'unknown',
                          page_url: pageWebVitals.url,
                        },
                        entry.responseEnd - entry.requestStart
                      );
                    }
                  }
                });
              }
            }
          });
        } else {
          console.warn('Invalid web vitals data structure:', pageWebVitals);
        }
      });

      // Export test metrics with URL context
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
                  url: testMetrics.currentUrl || 'unknown',
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