import { type Metric } from 'web-vitals';
import type { Page } from '@playwright/test';
import type { WebVitalsData } from '../types';

// Custom metric types to extend web-vitals
interface CustomPerformanceMetric extends Omit<Metric, 'name' | 'entries'> {
  name: 'RESOURCE_TIMING' | 'NAVIGATION_TIMING';
  entries: Array<PerformanceEntry & {
    requestStart?: number;
    responseEnd?: number;
  }>;
}

type CombinedMetric = Metric | CustomPerformanceMetric;

const WEB_VITALS_TIMEOUT = 10000; // Reduce timeout to 10 seconds
const METRIC_COLLECTION_TIMEOUT = 8000; // Individual metric collection timeout

export async function collectWebVitals(page: Page): Promise<WebVitalsData> {
  try {
    console.log(`Collecting Web Vitals for page: ${page.url()}`);
    
    const metrics = await page.evaluate((timeout) => {
      return new Promise<CombinedMetric[]>((resolve) => {
        const metrics: CombinedMetric[] = [];
        const resolvedMetrics = new Set<string>();
        let timeoutId: NodeJS.Timeout;

        // Collect resource timing data
        const collectResourceTiming = () => {
          try {
            const resources = performance.getEntriesByType('resource');
            const navigationEntries = performance.getEntriesByType('navigation');
            
            // Add resource timing data to metrics array
            resources.forEach(resource => {
              const resourceMetric: CustomPerformanceMetric = {
                name: 'RESOURCE_TIMING',
                value: resource.duration,
                rating: 'needs-improvement',
                entries: [{
                  ...resource,
                  requestStart: (resource as PerformanceResourceTiming).requestStart,
                  responseEnd: (resource as PerformanceResourceTiming).responseEnd,
                }],
                id: resource.name,
                navigationType: 'navigate',
                delta: resource.duration
              };
              metrics.push(resourceMetric);
            });

            // Add navigation timing data
            navigationEntries.forEach(entry => {
              const navigationMetric: CustomPerformanceMetric = {
                name: 'NAVIGATION_TIMING',
                value: entry.duration,
                rating: 'needs-improvement',
                entries: [{
                  ...entry,
                  requestStart: (entry as PerformanceNavigationTiming).requestStart,
                  responseEnd: (entry as PerformanceNavigationTiming).responseEnd,
                }],
                id: document.location.href,
                navigationType: 'navigate',
                delta: entry.duration
              };
              metrics.push(navigationMetric);
            });
          } catch (e) {
            console.error('Error collecting resource timing:', e);
          }
        };

        const checkComplete = () => {
          // Collect resource timing data
          collectResourceTiming();
          
          // Resolve if we have any core metrics or if resource timing data is available
          if (metrics.length > 0 && (
              resolvedMetrics.has('FCP') || 
              resolvedMetrics.has('LCP') || 
              metrics.some(m => m.name === 'RESOURCE_TIMING')
          )) {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            console.log(`Collected ${metrics.length} total metrics (including resource timing)`);
            resolve(metrics);
            return true;
          }
          return false;
        };

        const onMetric = (metric: Metric) => {
          console.log(`Received web vital: ${metric.name} = ${metric.value}`);
          metrics.push(metric);
          resolvedMetrics.add(metric.name);
          
          checkComplete();
        };

        // Set a timeout to resolve with whatever metrics we have
        timeoutId = setTimeout(() => {
          console.log('Web vitals collection timed out, collecting final metrics');
          if (!checkComplete()) {
            console.log(`Resolving with ${metrics.length} metrics due to timeout`);
            resolve(metrics);
          }
        }, timeout);

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
            if (!checkComplete()) {
              // Set a shorter timeout for initial collection
              setTimeout(() => {
                if (!checkComplete()) {
                  console.log('Resolving with initial metrics');
                  resolve(metrics);
                }
              }, timeout / 2);
            }
          } catch (e) {
            console.error('Error setting up web vitals handlers:', e);
            // Resolve with whatever we have
            resolve(metrics);
          }
        };

        script.onerror = (e) => {
          console.error('Failed to load web-vitals library:', e);
          // Still try to collect resource timing even if web-vitals fails
          collectResourceTiming();
          resolve(metrics);
        };

        document.head.appendChild(script);
      });
    }, METRIC_COLLECTION_TIMEOUT);
    
    console.log(`Collected ${metrics.length} total metrics for ${page.url()}`);
    
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