import { type Metric } from 'web-vitals';
import type { Page } from '@playwright/test';
import type { WebVitalsData } from '../types';

const WEB_VITALS_TIMEOUT = 15000; // 15 seconds timeout

export async function collectWebVitals(page: Page): Promise<WebVitalsData> {
  try {
    console.log(`Collecting Web Vitals for page: ${page.url()}`);
    
    const metrics = await page.evaluate(() => {
      return new Promise<Metric[]>((resolve) => {
        const metrics: Metric[] = [];
        const resolvedMetrics = new Set<string>();
        let timeoutId: NodeJS.Timeout;

        // Collect resource timing data
        const collectResourceTiming = () => {
          const resources = performance.getEntriesByType('resource');
          const navigationEntries = performance.getEntriesByType('navigation');
          
          // Add resource timing data to metrics array
          resources.forEach(resource => {
            metrics.push({
              name: 'RESOURCE_TIMING',
              value: resource.duration,
              rating: 'neutral',
              entries: [{
                name: resource.name,
                entryType: resource.initiatorType,
                startTime: resource.startTime,
                duration: resource.duration,
                requestStart: (resource as PerformanceResourceTiming).requestStart,
                responseEnd: (resource as PerformanceResourceTiming).responseEnd,
              }],
            });
          });

          // Add navigation timing data
          navigationEntries.forEach(entry => {
            metrics.push({
              name: 'NAVIGATION_TIMING',
              value: entry.duration,
              rating: 'neutral',
              entries: [{
                name: document.location.href,
                entryType: 'navigation',
                startTime: entry.startTime,
                duration: entry.duration,
                requestStart: (entry as PerformanceNavigationTiming).requestStart,
                responseEnd: (entry as PerformanceNavigationTiming).responseEnd,
              }],
            });
          });
        };

        const checkComplete = () => {
          // Collect resource timing data before resolving
          collectResourceTiming();
          
          // If we have at least the core metrics, consider it complete
          if (resolvedMetrics.has('CLS') && 
              resolvedMetrics.has('FCP') && 
              resolvedMetrics.has('LCP')) {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            console.log(`Collected ${metrics.length} total metrics (including resource timing)`);
            resolve(metrics);
          }
        };

        const onMetric = (metric: Metric) => {
          console.log(`Received web vital: ${metric.name} = ${metric.value}`);
          metrics.push(metric);
          resolvedMetrics.add(metric.name);
          
          checkComplete();
        };

        // Load web-vitals library
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js';
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

            // Force an initial resource timing collection
            collectResourceTiming();
          } catch (e) {
            console.error('Error setting up web vitals handlers:', e);
          }

          // Set a timeout to resolve with whatever metrics we have
          timeoutId = setTimeout(() => {
            console.log('Web vitals collection timed out, collecting final metrics');
            collectResourceTiming(); // Collect final resource timing before timeout
            console.log(`Resolving with ${metrics.length} total metrics`);
            resolve(metrics);
          }, WEB_VITALS_TIMEOUT - 1000); // Leave 1 second buffer for final collection
        };

        script.onerror = (e) => {
          console.error('Failed to load web-vitals library:', e);
          // Still try to collect resource timing even if web-vitals fails
          collectResourceTiming();
          resolve(metrics);
        };

        document.head.appendChild(script);
      });
    }, { timeout: WEB_VITALS_TIMEOUT });
    
    console.log(`Collected ${metrics.length} total metrics for ${page.url()}`);
    
    return {
      metrics,
      timestamp: Date.now(),
      url: page.url(),
    };
  } catch (error) {
    console.error(`Error collecting web vitals for ${page.url()}:`, error);
    return {
      metrics: [],
      timestamp: Date.now(),
      url: page.url(),
    };
  }
}