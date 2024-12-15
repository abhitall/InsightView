import { type Metric } from 'web-vitals';
import type { Page } from '@playwright/test';
import type { WebVitalsData } from '../types';

export async function collectWebVitals(page: Page): Promise<WebVitalsData> {
  const metrics = await page.evaluate(() => {
    return new Promise<Metric[]>((resolve) => {
      const metrics: Metric[] = [];
      let metricsCollected = 0;
      const totalMetrics = 6; // CLS, FCP, FID, INP, LCP, TTFB

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

  return {
    metrics,
    timestamp: Date.now(),
    url: page.url(),
  };
}