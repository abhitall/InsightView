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

const WEB_VITALS_TIMEOUT = 15000; // 15 seconds timeout
const METRIC_COLLECTION_TIMEOUT = 12000; // Individual metric collection timeout

// Separate core web vitals into required and optional
const REQUIRED_VITALS = ['FCP', 'LCP', 'TTFB'] as const;
const OPTIONAL_VITALS = ['CLS', 'FID', 'INP'] as const;
const ALL_VITALS = [...REQUIRED_VITALS, ...OPTIONAL_VITALS] as const;

// Pages where we should skip web vitals collection
const SKIP_VITALS_PAGES = ['about:blank', 'about:srcdoc'];

export async function collectWebVitals(page: Page): Promise<WebVitalsData> {
  const url = page.url();
  
  // Skip web vitals collection for special pages
  if (SKIP_VITALS_PAGES.includes(url)) {
    console.log(`Skipping web vitals collection for special page: ${url}`);
    return {
      metrics: [],
      timestamp: Date.now(),
      url: url,
    };
  }

  try {
    console.log(`Collecting Web Vitals for page: ${url}`);
    
    // Check if page is still valid before proceeding
    if (!page.isClosed()) {
      // Inject web-vitals library early
      await page.addScriptTag({
        url: 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js',
        type: 'text/javascript'
      }).catch(e => {
        console.error('Failed to inject web-vitals library:', e);
        throw e;
      });
    } else {
      throw new Error('Page is closed');
    }
    
    const metrics = await page.evaluate(
      ({ timeout, requiredVitals, allVitals }: { 
        timeout: number; 
        requiredVitals: readonly string[];
        allVitals: readonly string[];
      }) => {
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
            // Check if we have all required web vitals
            const hasRequiredMetrics = requiredVitals.every(metric => 
              metrics.some(m => m.name === metric)
            );
            
            // Also resolve if we have at least one metric and some time has passed
            const shouldResolveEarly = metrics.length > 0 && 
              performance.now() > timeout / 2;
            
            if (hasRequiredMetrics || shouldResolveEarly) {
              console.log(hasRequiredMetrics ? 
                'All required web vitals collected' : 
                'Resolving early with partial metrics');
              
              collectResourceTiming();
              
              // Log which metrics we got
              const collectedMetrics = allVitals.filter(metric => 
                metrics.some(m => m.name === metric)
              );
              if (collectedMetrics.length > 0) {
                console.log('Collected metrics:', collectedMetrics.join(', '));
              }
              
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              console.log(`Collected ${metrics.length} total metrics`);
              resolve(metrics);
              return true;
            }
            
            // If we have some metrics but not all required ones, log progress
            if (metrics.length > 0) {
              console.log(`Have ${metrics.length} metrics so far`);
              console.log('Missing required metrics:', requiredVitals.filter(metric => 
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
            if (metrics.length > 0) {
              console.log('Collected metrics:', metrics.map(m => m.name).join(', '));
            }
            console.log('Missing required metrics:', requiredVitals.filter(metric => 
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
            // Still try to collect resource timing data
            collectResourceTiming();
            resolve(metrics);
          }
        });
      },
      { 
        timeout: METRIC_COLLECTION_TIMEOUT, 
        requiredVitals: REQUIRED_VITALS,
        allVitals: ALL_VITALS
      }
    );
    
    console.log(`Collected ${metrics.length} total metrics for ${url}`);
    if (metrics.length > 0) {
      console.log('Metrics:', metrics.map(m => `${m.name}=${m.value}`).join(', '));
    }
    
    return {
      metrics,
      timestamp: Date.now(),
      url: url,
    };
  } catch (error) {
    console.error(`Error collecting web vitals for ${url}:`, error);
    return {
      metrics: [],
      timestamp: Date.now(),
      url: url,
    };
  }
}