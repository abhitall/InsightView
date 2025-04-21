import { type Metric } from 'web-vitals';
import type { Page } from '@playwright/test';
import type { WebVitalsData } from '../types';

const WEB_VITALS_TIMEOUT = 15000; // Increase timeout to 15 seconds

export async function collectWebVitals(page: Page): Promise<WebVitalsData> {
  try {
    console.log(`Collecting Web Vitals for page: ${page.url()}`);
    
    const metrics = await page.evaluate(() => {
      return new Promise<Metric[]>((resolve) => {
        const metrics: Metric[] = [];
        const resolvedMetrics = new Set<string>();
        let timeoutId: NodeJS.Timeout;

        const checkComplete = () => {
          // If we have at least some metrics, consider it complete
          if (resolvedMetrics.size > 0) {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            console.log(`Collected ${metrics.length} web vitals metrics`);
            resolve(metrics);
          }
        };

        const onMetric = (metric: Metric) => {
          console.log(`Received web vital: ${metric.name} = ${metric.value}`);
          metrics.push(metric);
          resolvedMetrics.add(metric.name);
          
          // If we have all core metrics, resolve early
          if (resolvedMetrics.has('CLS') && 
              resolvedMetrics.has('FCP') && 
              resolvedMetrics.has('LCP')) {
            checkComplete();
          }
        };

        // Load web-vitals library
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js'; // Use specific version
        script.onload = () => {
          console.log('Web Vitals library loaded');
          
          // Attach metric collection handlers
          try {
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
          } catch (e) {
            console.error('Error setting up web vitals handlers:', e);
          }

          // Set a timeout to resolve with whatever metrics we have
          timeoutId = setTimeout(() => {
            console.log(`Web vitals collection timed out with ${metrics.length} metrics`);
            resolve(metrics);
          }, 10000); // 10 seconds timeout for metrics collection
        };

        script.onerror = (e) => {
          console.error('Failed to load web-vitals library:', e);
          resolve([]); // Return empty array on error
        };

        document.head.appendChild(script);
      });
    }, { timeout: WEB_VITALS_TIMEOUT }); // Set page.evaluate timeout
    
    console.log(`Collected ${metrics.length} web vitals metrics for ${page.url()}`);
    
    return {
      metrics,
      timestamp: Date.now(),
      url: page.url(),
    };
  } catch (error) {
    console.error(`Error collecting web vitals for ${page.url()}:`, error);
    // Return empty metrics rather than failing
    return {
      metrics: [],
      timestamp: Date.now(),
      url: page.url(),
    };
  }
}