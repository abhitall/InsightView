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
        // Wait for page to be stable before collecting metrics
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000); // Additional wait for metrics to stabilize
        
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

        // Collect test metrics for each page
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
      } catch (error) {
        console.error('Error collecting metrics:', error);
        // Don't throw here to allow the test to continue
      }
    };

    // Use the monitoring function
    await use(monitoring);

    // After the test completes, send all collected metrics
    if (collectedMetrics.webVitals.length > 0 || collectedMetrics.testMetrics) {
      try {
        // Get environment information
        const userAgent = await page.evaluate(() => navigator.userAgent);
        const viewport = page.viewportSize() || { width: 0, height: 0 };
        const browserVersion = await page.evaluate(() => {
          const match = navigator.userAgent.match(/Chrome\/([0-9.]+)/);
          return match ? match[1] : '';
        });

        // Combine all metrics into a single report
        const report: MonitoringReport = {
          webVitals: collectedMetrics.webVitals,
          testMetrics: collectedMetrics.testMetrics ?? { metrics: [], labels: {} },
          timestamp: Date.now(),
          environment: {
            userAgent,
            viewport,
            browser: {
              name: browserName,
              version: browserVersion,
              device: testInfo.project.name,
            },
          },
        };

        // Send to Prometheus with retry
        const prometheusExporter = new PrometheusExporter();
        try {
          await prometheusExporter.export(report);
        } catch (error) {
          console.error('Failed to send metrics to Prometheus:', error);
          // Continue with S3 export even if Prometheus fails
        }

        // Send to S3 if configured
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
          try {
            const s3Exporter = new S3Exporter();
            await s3Exporter.export(report, testInfo);
          } catch (error) {
            console.error('Failed to send metrics to S3:', error);
          }
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