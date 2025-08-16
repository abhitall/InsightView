import { test as base, type Page, type TestInfo } from '@playwright/test';
import { collectWebVitals } from './collectors/webVitals';
import { collectTestMetrics } from './collectors/testMetrics';
import { collectLighthouseReport } from './collectors/lightHouse';
import { PrometheusExporter } from './exporters/prometheus';
import { S3Exporter } from './exporters/s3';
import type { WebVitalsData, TestMetrics, MonitoringReport, LighthouseReport } from './types';

// Extend the base test with our monitoring fixture
export const test = base.extend<{
  monitoring: () => Promise<void>;
}>({
  monitoring: async ({ page, browserName }, use, testInfo) => {
    const startTime = Date.now();
    const collectedMetrics: {
      webVitals: WebVitalsData[];
      testMetrics: TestMetrics | null;
      lighthouseReports: LighthouseReport[];
    } = {
      webVitals: [],
      testMetrics: null,
      lighthouseReports: [],
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

        // Collect Lighthouse report
        const lighthouseReportHtml = await collectLighthouseReport(page);
        if (lighthouseReportHtml) {
          collectedMetrics.lighthouseReports.push({
            html: lighthouseReportHtml,
            url: page.url(),
            timestamp: Date.now(),
          });
        }

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
          lighthouseReports: collectedMetrics.lighthouseReports,
          testMetrics: collectedMetrics.testMetrics ?? { 
            duration: Date.now() - startTime,
            status: 'failed' as const,
            name: testInfo.title,
            retries: 0,
            steps: [],
            resourceStats: {
              totalRequests: 0,
              failedRequests: 0,
              totalBytes: 0,
              loadTime: 0
            },
            navigationStats: {
              domContentLoaded: 0,
              load: 0,
              firstPaint: 0
            },
            assertions: {
              total: 0,
              passed: 0,
              failed: 0
            },
            labels: { 
              testId: testInfo.testId || "unknown", 
              testTitle: testInfo.title || "unknown", 
              timestamp: Date.now(), 
              url: page.url() || "" 
            } 
          },
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
        const hasS3Endpoint = process.env.S3_ENDPOINT || process.env.MINIO_ENDPOINT;
        const hasS3Bucket = process.env.S3_BUCKET;
        const hasCredentials = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
                             (process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY) ||
                             (process.env.MINIO_ROOT_USER && process.env.MINIO_ROOT_PASSWORD);
        
        if (hasS3Endpoint && hasS3Bucket) {
          try {
            const s3Exporter = new S3Exporter();
            await s3Exporter.export(report, testInfo);
          } catch (error) {
            console.error('Failed to send metrics to S3:', error);
          }
        } else {
          console.log('S3 export disabled - missing required environment variables:', {
            hasEndpoint: !!hasS3Endpoint,
            hasBucket: !!hasS3Bucket,
            hasCredentials: !!hasCredentials
          });
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