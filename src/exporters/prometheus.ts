import { Registry, Gauge, Histogram } from 'prom-client';
import type { MonitoringReport } from '../types';

export class PrometheusExporter {
  private registry: Registry;
  private webVitalsGauge: Gauge;
  private testMetricsGauge: Gauge;
  private testDurationHistogram: Histogram;
  private resourceMetricsHistogram: Histogram;
  private apiMetricsHistogram: Histogram;
  private apiResponseSizeHistogram: Histogram;
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

    this.testDurationHistogram = new Histogram({
      name: 'synthetic_monitoring_test_duration',
      help: 'Test execution duration distribution',
      labelNames: [
        'url',
        'test_id',
        'test_title',
        'browser',
        'device',
        'status',
        'action_run_id',
        'repository',
        'workflow'
      ],
      buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
      registers: [this.registry],
    });

    this.resourceMetricsHistogram = new Histogram({
      name: 'synthetic_monitoring_resource_metrics',
      help: 'Resource timing metrics distribution',
      labelNames: [
        'metric',
        'url',
        'test_id',
        'test_title',
        'browser',
        'device',
        'action_run_id',
        'repository',
        'workflow'
      ],
      buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });

    this.apiMetricsHistogram = new Histogram({
      name: 'synthetic_monitoring_api_metrics',
      help: 'API endpoint metrics distribution',
      labelNames: [
        'endpoint',
        'method',
        'status_code',
        'test_id',
        'test_title',
        'browser',
        'device',
        'action_run_id',
        'repository',
        'workflow'
      ],
      buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });

    this.apiResponseSizeHistogram = new Histogram({
      name: 'synthetic_monitoring_api_response_size',
      help: 'API response size distribution',
      labelNames: [
        'endpoint',
        'method',
        'status_code',
        'test_id',
        'test_title',
        'browser',
        'device',
        'action_run_id',
        'repository',
        'workflow'
      ],
      buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
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
      const commonLabels = {
        ...baseLabels,
        url: testMetrics.labels.url,
        test_id: testMetrics.labels.testId,
        test_title: sanitizedTitle,
        timestamp: String(testMetrics.labels.timestamp),
        status: testMetrics.status,
      };

      // Record test duration in histogram
      this.testDurationHistogram.observe(
        { ...commonLabels },
        testMetrics.duration
      );

      // Export core test metrics
      this.testMetricsGauge.set(
        { ...commonLabels, metric: 'duration' },
        testMetrics.duration
      );

      this.testMetricsGauge.set(
        { ...commonLabels, metric: 'retries' },
        testMetrics.retries
      );

      // Export test steps metrics if available
      if (testMetrics.steps) {
        testMetrics.steps.forEach((step, index) => {
          this.testMetricsGauge.set(
            { ...commonLabels, metric: `step_${index}_duration` },
            step.duration
          );
        });
      }

      // Export resource metrics if available
      if (testMetrics.resourceStats) {
        // Record resource metrics in histogram
        this.resourceMetricsHistogram.observe(
          { ...commonLabels, metric: 'load_time' },
          testMetrics.resourceStats.loadTime
        );

        // Export as gauges for current values
        this.testMetricsGauge.set(
          { ...commonLabels, metric: 'total_requests' },
          testMetrics.resourceStats.totalRequests
        );
        this.testMetricsGauge.set(
          { ...commonLabels, metric: 'failed_requests' },
          testMetrics.resourceStats.failedRequests
        );
        this.testMetricsGauge.set(
          { ...commonLabels, metric: 'total_bytes' },
          testMetrics.resourceStats.totalBytes
        );
      }

      // Export navigation metrics if available
      if (testMetrics.navigationStats) {
        this.testMetricsGauge.set(
          { ...commonLabels, metric: 'dom_content_loaded' },
          testMetrics.navigationStats.domContentLoaded
        );
        this.testMetricsGauge.set(
          { ...commonLabels, metric: 'load' },
          testMetrics.navigationStats.load
        );
        this.testMetricsGauge.set(
          { ...commonLabels, metric: 'first_paint' },
          testMetrics.navigationStats.firstPaint
        );
      }

      // Export assertion metrics if available
      if (testMetrics.assertions) {
        this.testMetricsGauge.set(
          { ...commonLabels, metric: 'total_assertions' },
          testMetrics.assertions.total
        );
        this.testMetricsGauge.set(
          { ...commonLabels, metric: 'passed_assertions' },
          testMetrics.assertions.passed
        );
        this.testMetricsGauge.set(
          { ...commonLabels, metric: 'failed_assertions' },
          testMetrics.assertions.failed
        );
      }

      // Export API metrics if available
      if (testMetrics.apiMetrics) {
        for (const apiMetric of testMetrics.apiMetrics) {
          const apiLabels = {
            ...baseLabels,
            endpoint: apiMetric.endpoint,
            method: apiMetric.method,
            status_code: String(apiMetric.statusCode),
            test_id: testMetrics.labels.testId,
            test_title: sanitizedTitle,
          };

          // Record API duration
          this.apiMetricsHistogram.observe(
            apiLabels,
            apiMetric.duration
          );

          // Record API response size if available
          if (apiMetric.responseSize) {
            this.apiResponseSizeHistogram.observe(
              apiLabels,
              apiMetric.responseSize
            );
          }

          // Record API success/failure
          this.testMetricsGauge.set(
            { ...commonLabels, metric: 'api_success' },
            apiMetric.success ? 1 : 0
          );
        }
      }

      console.log('Setting test metrics with labels:', commonLabels);

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

    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
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
        return;
      } catch (error) {
        retryCount++;
        if (retryCount === maxRetries) {
          console.error('Error pushing metrics to Prometheus Pushgateway after retries:', error);
          throw error;
        }
        console.warn(`Retry ${retryCount} of ${maxRetries} after error:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }
  }
}