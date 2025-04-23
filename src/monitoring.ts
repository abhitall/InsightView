import { test as base, type Page, type TestInfo } from '@playwright/test';
import { collectWebVitals } from './collectors/webVitals';
import { collectTestMetrics } from './collectors/testMetrics';
import { PrometheusExporter } from './exporters/prometheus';
import { S3Exporter } from './exporters/s3';
import type { WebVitalsData, TestMetrics, MonitoringReport } from './types';

// Extend the base test with our monitoring fixture
export const test = base.extend<{
  monitoring: () => Promise<void>;
}>({
  monitoring: async ({ page, browserName }, use, testInfo) => {
    const startTime = Date.now();
    const collectedMetrics: {
      webVitals: WebVitalsData[];
      testMetrics: TestMetrics | null;
    } = {
      webVitals: [],
      testMetrics: null
    };

    // Create the monitoring function that collects metrics
    const monitoring = async () => {
      try {
        console.log(`Collecting metrics for page: ${page.url()}`);
        
        // Collect web vitals
        const webVitals = await collectWebVitals(page);
        
        // Add test metadata to web vitals
        const enrichedWebVitals: WebVitalsData = {
          metrics: webVitals.metrics.map(metric => ({
            ...metric,
            labels: {
              testId: testInfo.testId,
              testTitle: testInfo.title,
              pageIndex: collectedMetrics.webVitals.length,
              timestamp: Date.now(),
              url: page.url()
            }
          }))
        };
        
        collectedMetrics.webVitals.push(enrichedWebVitals);
        console.log(`Collected ${webVitals.metrics.length} web vitals metrics for page ${collectedMetrics.webVitals.length}`);

        // Collect test metrics only once at the end
        if (!collectedMetrics.testMetrics) {
          const testMetrics = await collectTestMetrics(page, testInfo, startTime);
          collectedMetrics.testMetrics = {
            ...testMetrics,
            labels: {
              testId: testInfo.testId,
              testTitle: testInfo.title,
              timestamp: Date.now(),
              url: page.url()
            }
          };
          console.log('Collected test metrics');
        }
      } catch (error) {
        console.error('Error collecting metrics:', error);
      }
    };

    // Use the monitoring function
    await use(monitoring);

    // After the test completes, send all collected metrics
    if (collectedMetrics.webVitals.length > 0 || collectedMetrics.testMetrics) {
      try {
        console.log('Sending collected metrics...');
        console.log(`Total pages with web vitals: ${collectedMetrics.webVitals.length}`);
        console.log(`Test ID: ${testInfo.testId}`);

        // Combine all metrics into a single report
        const report: MonitoringReport = {
          webVitals: collectedMetrics.webVitals,
          testMetrics: collectedMetrics.testMetrics!,
          timestamp: Date.now(),
          environment: {
            userAgent: await page.evaluate(() => navigator.userAgent),
            viewport: page.viewportSize() || { width: 0, height: 0 },
            browser: {
              name: browserName,
              version: await page.evaluate(() => navigator.userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || ''),
              device: testInfo.project.name,
            },
          },
        };

        // Send to Prometheus
        const prometheusExporter = new PrometheusExporter();
        await prometheusExporter.export(report);
        console.log('Metrics sent to Prometheus');

        // Send to S3 if configured
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
          const s3Exporter = new S3Exporter();
          await s3Exporter.export(report, testInfo);
          console.log('Metrics sent to S3');
        }
      } catch (error) {
        console.error('Error sending collected metrics:', error);
      }
    } else {
      console.log('No metrics collected during test');
    }
  }
});

export { expect } from '@playwright/test';