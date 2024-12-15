import { test as base } from '@playwright/test';
import { collectWebVitals } from './monitoring/webVitals';
import { collectTestMetrics } from './monitoring/testMetrics';
import { pushMetricsToPrometheus } from './exporters/prometheusExporter';
import { uploadTraceToS3 } from './exporters/s3Exporter';
import type { MonitoringReport } from './types';

export const test = base.extend({
  monitoring: async ({ page, browserName }, use, testInfo) => {
    const startTime = Date.now();
    
    await use(async () => {
      const [webVitalsMetrics, testMetrics] = await Promise.all([
        collectWebVitals(page),
        collectTestMetrics(page, testInfo, startTime),
      ]);
      
      const report: MonitoringReport = {
        webVitals: {
          metrics: webVitalsMetrics,
          timestamp: Date.now(),
          url: page.url(),
        },
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
        pushMetricsToPrometheus(report),
        uploadTraceToS3(report, testInfo),
      ]);
    });
  },
});