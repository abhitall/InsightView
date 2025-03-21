import { type Metric } from 'web-vitals';
import type { Page } from '@playwright/test';
import type { WebVitalsData } from '../types/index.js';

const WEB_VITALS_TIMEOUT = 10000; // 10 seconds timeout

export async function collectWebVitals(page: Page): Promise<WebVitalsData> {
  const metrics = await page.evaluate(() => {
    return new Promise<Metric[]>((resolve) => {
      const metrics: Metric[] = [];
      const resolvedMetrics = new Set<string>();
      let timeoutId: NodeJS.Timeout;

      const checkComplete = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(metrics);
      };

      const onMetric = (metric: Metric) => {
        metrics.push(metric);
        resolvedMetrics.add(metric.name);
        
        // If we have all core metrics, resolve early
        if (resolvedMetrics.has('CLS') && 
            resolvedMetrics.has('FCP') && 
            resolvedMetrics.has('LCP')) {
          checkComplete();
        }
      };

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/web-vitals/dist/web-vitals.iife.js';
      script.onload = () => {
        // @ts-ignore
        webVitals.onCLS(onMetric);
        // @ts-ignore
        webVitals.onFCP(onMetric);
        // @ts-ignore
        webVitals.onFID(onMetric);
        // @ts-ignore
        webVitals.onINP(onMetric);
        // @ts-ignore
        webVitals.onLCP(onMetric);
        // @ts-ignore
        webVitals.onTTFB(onMetric);

        // Set a timeout to resolve with whatever metrics we have
        timeoutId = setTimeout(checkComplete, 8000); // 8 seconds timeout for metrics collection
      };

      document.head.appendChild(script);
    });
  }, { timeout: WEB_VITALS_TIMEOUT }); // Set page.evaluate timeout

  return {
    metrics,
    timestamp: Date.now(),
    url: page.url(),
  };
}