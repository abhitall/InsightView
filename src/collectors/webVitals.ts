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

const WEB_VITALS_TIMEOUT = 8000; // Reduce to 8 seconds
const METRIC_COLLECTION_TIMEOUT = 6000; // Reduce to 6 seconds
const EARLY_RESOLVE_THRESHOLD = 2000; // Resolve after 2 seconds if we have any metrics

// Separate core web vitals into required and optional
const REQUIRED_VITALS = ['FCP', 'TTFB'] as const; // Only require FCP and TTFB
const OPTIONAL_VITALS = ['CLS', 'FID', 'INP', 'LCP'] as const;
const ALL_VITALS = [...REQUIRED_VITALS, ...OPTIONAL_VITALS] as const;

// Pages where we should skip web vitals collection
const SKIP_VITALS_PAGES = ['about:blank', 'about:srcdoc'];

export async function collectWebVitals(page: Page): Promise<WebVitalsData> {
  const url = page.url();
  const startTime = Date.now();
  
  // Skip web vitals collection for special pages
  if (SKIP_VITALS_PAGES.includes(url)) {
    console.log(`Skipping web vitals collection for special page: ${url}`);
    return {
      metrics: [],
      timestamp: startTime,
      url: url,
    };
  }

  try {
    console.log(`Starting Web Vitals collection for page: ${url}`);
    
    // Check if page is still valid before proceeding
    if (!page.isClosed()) {
      // First try to check if web-vitals is already loaded
      const hasWebVitals = await page.evaluate(() => {
        return typeof (window as any).webVitals !== 'undefined';
      }).catch(() => false);

      if (!hasWebVitals) {
        console.log('Injecting web-vitals library...');
        await page.addScriptTag({
          url: 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js',
          type: 'text/javascript'
        }).catch(e => {
          console.error('Failed to inject web-vitals library:', e);
          throw e;
        });
      }
    } else {
      throw new Error('Page is closed');
    }
    
    const metrics = await Promise.race([
      page.evaluate(
        ({ timeout, requiredVitals, allVitals, earlyThreshold }: { 
          timeout: number; 
          requiredVitals: readonly string[];
          allVitals: readonly string[];
          earlyThreshold: number;
        }) => {
          return new Promise<CombinedMetric[]>((resolve) => {
            const metrics: CombinedMetric[] = [];
            const resolvedMetrics = new Set<string>();
            let timeoutId: NodeJS.Timeout;
            const startTime = performance.now();

            // Collect resource timing data
            const collectResourceTiming = () => {
              try {
                const resources = performance.getEntriesByType('resource');
                const navigationEntries = performance.getEntriesByType('navigation');
                
                if (resources.length > 0 || navigationEntries.length > 0) {
                  console.log(`Found ${resources.length} resources and ${navigationEntries.length} navigation entries`);
                }
                
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
              const elapsedTime = performance.now() - startTime;
              
              // Check if we have all required web vitals
              const hasRequiredMetrics = requiredVitals.every(metric => 
                metrics.some(m => m.name === metric)
              );
              
              // Resolve early if:
              // 1. We have all required metrics, or
              // 2. We have any metrics and have waited at least earlyThreshold ms, or
              // 3. We've waited more than half the timeout
              const shouldResolveEarly = 
                hasRequiredMetrics || 
                (metrics.length > 0 && elapsedTime > earlyThreshold) ||
                elapsedTime > (timeout / 2);
              
              if (shouldResolveEarly) {
                console.log(
                  hasRequiredMetrics ? 'All required web vitals collected' : 
                  `Resolving early with ${metrics.length} metrics after ${elapsedTime.toFixed(0)}ms`
                );
                
                collectResourceTiming();
                
                // Log collected metrics
                const collectedMetrics = allVitals.filter(metric => 
                  metrics.some(m => m.name === metric)
                );
                if (collectedMetrics.length > 0) {
                  console.log('Collected web vitals:', collectedMetrics.join(', '));
                }
                
                if (timeoutId) {
                  clearTimeout(timeoutId);
                }
                
                resolve(metrics);
                return true;
              }
              
              // Log progress
              if (metrics.length > 0) {
                console.log(`Have ${metrics.length} metrics after ${elapsedTime.toFixed(0)}ms`);
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
              const elapsedTime = performance.now() - startTime;
              console.log(`Web vitals collection timed out after ${elapsedTime.toFixed(0)}ms`);
              collectResourceTiming();
              
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
          allVitals: ALL_VITALS,
          earlyThreshold: EARLY_RESOLVE_THRESHOLD
        }
      ),
      new Promise<CombinedMetric[]>((_, reject) => 
        setTimeout(() => reject(new Error('Evaluation timeout')), WEB_VITALS_TIMEOUT)
      )
    ]);
    
    const elapsedTime = Date.now() - startTime;
    console.log(`Completed web vitals collection for ${url} in ${elapsedTime}ms`);
    if (metrics.length > 0) {
      console.log('Final metrics:', metrics.map(m => `${m.name}=${m.value}`).join(', '));
    }
    
    return {
      metrics,
      timestamp: startTime,
      url: url,
    };
  } catch (error) {
    const elapsedTime = Date.now() - startTime;
    console.error(`Error collecting web vitals for ${url} after ${elapsedTime}ms:`, error);
    return {
      metrics: [],
      timestamp: startTime,
      url: url,
    };
  }
}