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

const WEB_VITALS_TIMEOUT = 30000; // Increase timeout to 30 seconds
const METRIC_COLLECTION_TIMEOUT = 25000; // Individual metric collection timeout

const CORE_WEB_VITALS = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'] as const;
type CoreWebVital = typeof CORE_WEB_VITALS[number];

export async function collectWebVitals(page: Page): Promise<WebVitalsData> {
  try {
    console.log(`Collecting Web Vitals for page: ${page.url()}`);
    
    // Inject web-vitals library early
    await page.addScriptTag({
      url: 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js',
      type: 'text/javascript'
    });
    
    const metrics = await page.evaluate(
      ({ timeout, coreWebVitals }: { timeout: number; coreWebVitals: readonly string[] }) => {
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
            // Check if we have all core web vitals
            const hasAllCoreMetrics = coreWebVitals.every(metric => 
              metrics.some(m => m.name === metric)
            );
            
            if (hasAllCoreMetrics) {
              console.log('All core web vitals collected');
              collectResourceTiming();
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              console.log(`Collected ${metrics.length} total metrics`);
              resolve(metrics);
              return true;
            }
            
            // If we have some metrics but not all, wait for more
            if (metrics.length > 0) {
              console.log(`Have ${metrics.length} metrics, waiting for more...`);
              console.log('Missing metrics:', coreWebVitals.filter(metric => 
                !metrics.some(m => m.name === metric)
              ));
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
            collectResourceTiming();
            console.log(`Resolving with ${metrics.length} metrics due to timeout`);
            console.log('Collected metrics:', metrics.map(m => m.name).join(', '));
            console.log('Missing metrics:', coreWebVitals.filter(metric => 
              !metrics.some(m => m.name === metric)
            ));
            resolve(metrics);
          }, timeout);

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
            resolve(metrics);
          }
        });
      },
      { timeout: METRIC_COLLECTION_TIMEOUT, coreWebVitals: CORE_WEB_VITALS }
    );
    
    console.log(`Collected ${metrics.length} total metrics for ${page.url()}`);
    console.log('Metrics:', metrics.map(m => `${m.name}=${m.value}`).join(', '));
    
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