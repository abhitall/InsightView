import { Metric } from 'web-vitals';
import { Page } from '@playwright/test';
import { WEB_VITALS_METRICS } from '../constants';

export async function collectWebVitals(page: Page): Promise<Metric[]> {
  return await page.evaluate(() => {
    return new Promise((resolve) => {
      const metrics: Metric[] = [];
      let metricsCollected = 0;
      const totalMetrics = WEB_VITALS_METRICS.length;

      const checkComplete = () => {
        if (metricsCollected === totalMetrics) {
          resolve(metrics);
        }
      };

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/web-vitals/dist/web-vitals.iife.js';
      script.onload = () => {
        // @ts-ignore
        webVitals.onCLS((metric) => {
          metrics.push(metric);
          metricsCollected++;
          checkComplete();
        });
        // @ts-ignore
        webVitals.onFCP((metric) => {
          metrics.push(metric);
          metricsCollected++;
          checkComplete();
        });
        // @ts-ignore
        webVitals.onFID((metric) => {
          metrics.push(metric);
          metricsCollected++;
          checkComplete();
        });
        // @ts-ignore
        webVitals.onINP((metric) => {
          metrics.push(metric);
          metricsCollected++;
          checkComplete();
        });
        // @ts-ignore
        webVitals.onLCP((metric) => {
          metrics.push(metric);
          metricsCollected++;
          checkComplete();
        });
        // @ts-ignore
        webVitals.onTTFB((metric) => {
          metrics.push(metric);
          metricsCollected++;
          checkComplete();
        });
      };
      document.head.appendChild(script);
    });
  });
}