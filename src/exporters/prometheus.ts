import { Registry, Gauge, Histogram } from 'prom-client';
import type { MonitoringReport } from '../types';
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';

export class PrometheusExporter {
  private registry: Registry;
  private server: Server | undefined;
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
        'workflow',
        'status'
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
        'workflow',
        'timestamp'
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
        'workflow',
        'timestamp',
        'status'
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
        'workflow',
        'timestamp',
        'status'
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
        'workflow',
        'timestamp',
        'status'
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
            status: testMetrics.status
          };

          this.webVitalsGauge.set(labels, metric.value);
        }
      }

      // Export Test Metrics
      const sanitizedTitle = (testMetrics.labels.testTitle || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
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
            status: testMetrics.status
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

      // Metrics are now exposed via HTTP server, no need to push.
    } catch (error) {
      console.error('Error exporting metrics:', error);
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

  async startServer(port: number): Promise<void> {
    this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/metrics') {
        try {
          const metrics = await this.registry.metrics();
          res.setHeader('Content-Type', this.registry.contentType);
          res.end(metrics);
        } catch (ex) {
          res.statusCode = 500;
          res.end(ex instanceof Error ? ex.message : String(ex));
        }
      } else {
        res.statusCode = 404;
        res.end('Not Found');
      }
    });

    return new Promise((resolve, reject) => {
      if (!this.server) {
        return reject(new Error("Server not initialized"));
      }
      this.server.listen(port, () => {
        console.log(`Prometheus metrics server listening on port ${port}`);
        resolve();
      });
      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Error: Port ${port} is already in use. Failed to start Prometheus metrics server.`);
        } else {
          console.error('Failed to start Prometheus metrics server:', err);
        }
        reject(err);
      });
    });
  }

  async stopServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            console.error('Error stopping Prometheus metrics server:', err);
            return reject(err);
          }
          console.log('Prometheus metrics server stopped.');
          resolve();
        });
      } else {
        resolve(); // No server to stop
      }
    });
  }
}