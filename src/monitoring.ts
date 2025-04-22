import { test as base } from '@playwright/test';
import type { Page, TestType } from '@playwright/test';
import { collectWebVitals } from './collectors/webVitals';
import { collectTestMetrics } from './collectors/testMetrics';
import { PrometheusExporter } from './exporters/prometheus';
import { S3Exporter } from './exporters/s3';
import type { MonitoringReport } from './types';

const prometheusExporter = new PrometheusExporter();
const s3Exporter = new S3Exporter();

type MonitoringFixture = (pages?: Page[] | void) => Promise<void>;

interface TestFixtures {
  monitoring: MonitoringFixture;
}

// Store metrics per test
const testMetricsMap = new Map<string, Array<{
  webVitals: any;
  timestamp: number;
  pageUrl: string;
}>>();

export const test = base.extend<TestFixtures>({
  monitoring: async ({ page, browserName }, use, testInfo) => {
    const startTime = Date.now();
    const testId = testInfo.testId;
    
    // Initialize metrics array for this test if not exists
    if (!testMetricsMap.has(testId)) {
      testMetricsMap.set(testId, []);
    }
    
    await use(async (pages?: Page[] | void) => {
      // Collect Web Vitals from the specified pages or current page
      const targetPages = pages ? pages : [page];
      
      for (const targetPage of targetPages) {
        const timestamp = Date.now();
        const webVitals = await collectWebVitals(targetPage);
        
        // Store metrics with timestamp and page URL
        testMetricsMap.get(testId)?.push({
          webVitals,
          timestamp,
          pageUrl: targetPage.url()
        });
      }
      
      // After collecting all metrics for this test step
      const allMetrics = testMetricsMap.get(testId) || [];
      const testMetrics = await collectTestMetrics(page, testInfo, startTime);
      
      const report: MonitoringReport = {
        webVitals: allMetrics.map(m => ({
          ...m.webVitals,
          timestamp: m.timestamp,
          testId,
          testTitle: testInfo.title
        })),
        testMetrics,
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

      await Promise.all([
        prometheusExporter.export(report),
        s3Exporter.export(report, testInfo),
      ]);
    });
    
    // Clean up metrics after test completion
    testMetricsMap.delete(testId);
  },
});