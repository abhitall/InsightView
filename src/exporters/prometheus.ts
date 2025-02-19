import { Registry, Gauge } from 'prom-client';
import type { MonitoringReport, AlertRisk, AlertConfidence } from '../types';

export class PrometheusExporter {
  private registry: Registry;
  private webVitalsGauge: Gauge;
  private testMetricsGauge: Gauge;
  private zapMetricsGauge: Gauge;
  private zapAlertsGauge: Gauge;
  private zapStatsGauge: Gauge;

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

    this.zapMetricsGauge = new Gauge({
      name: 'synthetic_monitoring_zap_scan',
      help: 'ZAP security scan metrics',
      labelNames: ['test_name', 'scan_type', 'target_url', 'context_name', 'metric'],
      registers: [this.registry],
    });

    this.zapAlertsGauge = new Gauge({
      name: 'synthetic_monitoring_zap_alerts',
      help: 'ZAP security scan alerts by risk level and confidence',
      labelNames: ['test_name', 'scan_type', 'target_url', 'risk_level', 'confidence', 'plugin_id'],
      registers: [this.registry],
    });

    this.zapStatsGauge = new Gauge({
      name: 'synthetic_monitoring_zap_stats',
      help: 'ZAP security scan statistics',
      labelNames: ['test_name', 'scan_type', 'target_url', 'metric_type', 'metric_name'],
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
    const webVitalsArray = Array.isArray(webVitals) ? webVitals : [webVitals];
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

    // Export ZAP scan metrics if available
    if (report.zapScan) {
      const scanLabels = {
        test_name: testMetrics.name,
        scan_type: report.zapScan.scanType,
        target_url: report.zapScan.targetUrl,
        context_name: report.zapScan.contextName,
      };

      // Basic scan metrics
      this.zapMetricsGauge.set({ ...scanLabels, metric: 'duration_ms' }, report.zapScan.duration);
      this.zapMetricsGauge.set({ ...scanLabels, metric: 'total_urls' }, report.zapScan.stats.totalUrls);
      this.zapMetricsGauge.set({ ...scanLabels, metric: 'unique_urls' }, report.zapScan.stats.uniqueUrls);
      this.zapMetricsGauge.set({ ...scanLabels, metric: 'request_count' }, report.zapScan.stats.requestCount);

      // Time metrics
      Object.entries(report.zapScan.stats.timeMetrics).forEach(([metricName, value]) => {
        this.zapStatsGauge.set({
          ...scanLabels,
          metric_type: 'time',
          metric_name: metricName
        }, value);
      });

      // Alert metrics by risk level
      Object.entries(report.zapScan.stats.alertsByRisk).forEach(([risk, count]) => {
        this.zapStatsGauge.set({
          ...scanLabels,
          metric_type: 'risk',
          metric_name: risk.toLowerCase()
        }, count);
      });

      // Detailed alert metrics with plugin IDs
      const alertsByPlugin = new Map<string, Map<AlertRisk, Map<AlertConfidence, number>>>();
      report.zapScan.alerts.forEach(alert => {
        const pluginId = alert.pluginId || 'unknown';
        if (!alertsByPlugin.has(pluginId)) {
          alertsByPlugin.set(pluginId, new Map());
        }
        const riskMap = alertsByPlugin.get(pluginId)!;
        if (!riskMap.has(alert.risk)) {
          riskMap.set(alert.risk, new Map());
        }
        const confidenceMap = riskMap.get(alert.risk)!;
        const count = confidenceMap.get(alert.confidence) || 0;
        confidenceMap.set(alert.confidence, count + 1);
      });

      // Export detailed alert metrics
      alertsByPlugin.forEach((riskMap, pluginId) => {
        riskMap.forEach((confidenceMap, risk) => {
          confidenceMap.forEach((count, confidence) => {
            this.zapAlertsGauge.set({
              ...scanLabels,
              risk_level: risk,
              confidence: confidence,
              plugin_id: pluginId
            }, count);
          });
        });
      });
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
      headers: {
        'Content-Type': 'text/plain',
      }
    });
  }
}