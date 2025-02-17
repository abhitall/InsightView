import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectWebVitals } from './collectors/webVitals';
import { collectTestMetrics } from './collectors/testMetrics';
import { PrometheusExporter } from './exporters/prometheus';
import { S3Exporter } from './exporters/s3';
import type { MonitoringReport } from './types';

const prometheusExporter = new PrometheusExporter();
const s3Exporter = new S3Exporter();

export const test = base.extend({
  monitoring: async ({ page, browserName }, use, testInfo) => {
    const startTime = Date.now();
    
    await use(async (pages?: Page[] | void) => {
      // If pages array is provided, collect Web Vitals from all pages
      const webVitals = pages 
        ? await Promise.all(pages.map(p => collectWebVitals(p)))
        : await collectWebVitals(page);

      const testMetrics = await collectTestMetrics(page, testInfo, startTime);
      
      const report: MonitoringReport = {
        webVitals,
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
  },
});