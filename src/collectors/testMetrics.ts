import type { Page, TestInfo, Route, Request } from '@playwright/test';
import type { TestMetrics, TestStep, ResourceMetrics, NavigationMetrics, AssertionMetrics, ApiMetrics } from '../types';
import fs from 'fs';

async function collectResourceMetrics(page: Page): Promise<ResourceMetrics> {
  return await page.evaluate(() => {
    try {
      const resources = performance.getEntriesByType('resource');
      const failedRequests = resources.filter(r => r.duration === 0 || (r as PerformanceResourceTiming).responseStatus === 0).length;
      const totalBytes = resources.reduce((acc, res) => {
        const resource = res as PerformanceResourceTiming;
        return acc + (resource.transferSize || resource.encodedBodySize || 0);
      }, 0);
      const loadTime = Math.max(...resources.map(res => res.responseEnd), 0);

      console.log(`Resource metrics collected: ${resources.length} requests, ${failedRequests} failed, ${totalBytes} bytes`);
      return {
        totalRequests: resources.length,
        failedRequests,
        totalBytes,
        loadTime
      };
    } catch (error) {
      console.error('Error collecting resource metrics:', error);
      return {
        totalRequests: 0,
        failedRequests: 0,
        totalBytes: 0,
        loadTime: 0
      };
    }
  });
}

async function collectNavigationMetrics(page: Page): Promise<NavigationMetrics> {
  return await page.evaluate(() => {
    try {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      if (!navigation) {
        console.warn('No navigation timing entries found');
        return {
          domContentLoaded: 0,
          load: 0,
          firstPaint: 0
        };
      }

      const firstPaint = performance.getEntriesByName('first-paint')[0]?.startTime || 0;
      const metrics = {
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
        load: navigation.loadEventEnd - navigation.startTime,
        firstPaint
      };

      console.log('Navigation metrics collected:', metrics);
      return metrics;
    } catch (error) {
      console.error('Error collecting navigation metrics:', error);
      return {
        domContentLoaded: 0,
        load: 0,
        firstPaint: 0
      };
    }
  });
}

function sanitizeTestInfo(testInfo: TestInfo) {
  return {
    title: testInfo.title,
    status: testInfo.status || 'unknown',
    retry: testInfo.retry,
    titlePath: testInfo.titlePath,
    duration: testInfo.duration,
    errors: testInfo.errors.map(error => ({
      message: error.message,
      stack: error.stack
    }))
  };
}

async function collectApiMetrics(page: Page): Promise<ApiMetrics[]> {
  const apiRequests: ApiMetrics[] = [];
  
  // Set up request interception
  await page.route('**/*', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const headers = request.headers();
    const postData = request.postData();
    
    // Only track external API requests
    if (!url.startsWith('http') || url.includes(page.url())) {
      return route.continue();
    }
    
    const startTime = Date.now();
    let retryCount = 0;
    let retryDelay = 0;
    
    while (true) {
      try {
        const response = await route.fetch();
        const endTime = Date.now();
        
        // Get response data
        const responseHeaders = response.headers();
        const responseData = await response.json().catch(() => null);
        
        // Convert headers to plain object
        const headersObj: Record<string, string> = {};
        for (const [key, value] of Object.entries(responseHeaders)) {
          headersObj[key] = value;
        }
        
        // Get content length from headers
        const contentLength = responseHeaders['content-length'];
        const responseSize = contentLength ? parseInt(contentLength) : undefined;
        
        // Store API metrics
        apiRequests.push({
          endpoint: url,
          method,
          statusCode: response.status(),
          duration: endTime - startTime,
          success: response.ok(),
          responseSize,
          timestamp: startTime,
          requestHeaders: headers,
          responseHeaders: headersObj,
          responseData,
          requestBody: (() => {
            if (!postData) return undefined;
            try {
              return JSON.parse(postData);
            } catch (error) {
              console.error('Failed to parse postData as JSON:', error);
              return undefined;
            }
          })(),
          retryCount,
          retryDelay
        });
        
        return route.continue();
      } catch (error: unknown) {
        retryCount++;
        if (retryCount >= 3) {
          // Store failed request metrics
          apiRequests.push({
            endpoint: url,
            method,
            statusCode: 0,
            duration: Date.now() - startTime,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: startTime,
            requestHeaders: headers,
            requestBody: postData ? JSON.parse(postData) : undefined,
            retryCount,
            retryDelay
          });
          return route.continue();
        }
        
        retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  });
  
  return apiRequests;
}

export async function collectTestMetrics(page: Page, testInfo: TestInfo, startTime: number): Promise<TestMetrics> {
  const metrics: TestMetrics = {
    duration: 0,
    status: 'passed',
    name: testInfo.title,
    retries: testInfo.retry,
    labels: {
      testId: testInfo.testId,
      testTitle: testInfo.title,
      timestamp: Date.now(),
      url: page.url()
    },
    steps: [],
    resourceStats: {
      totalRequests: 0,
      failedRequests: 0,
      totalBytes: 0,
      loadTime: 0
    },
    navigationStats: {
      domContentLoaded: 0,
      load: 0,
      firstPaint: 0
    },
    assertions: {
      total: 0,
      passed: 0,
      failed: 0
    }
  };

  // Track API requests with retry handling
  const apiRequests = new Map<string, { count: number, lastAttempt: number }>();
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000; // 1 second

  // Set up route interception for API metrics
  const routeHandler = async (route: Route, request: Request) => {
    const url = request.url();
    const method = request.method();
    const startTime = Date.now();

    try {
      // Check if this is a retry
      const requestKey = `${method}:${url}`;
      const requestInfo = apiRequests.get(requestKey) || { count: 0, lastAttempt: 0 };
      
      if (requestInfo.count > 0) {
        const timeSinceLastAttempt = Date.now() - requestInfo.lastAttempt;
        if (timeSinceLastAttempt < RETRY_DELAY) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY - timeSinceLastAttempt));
        }
      }

      // Update request info
      requestInfo.count++;
      requestInfo.lastAttempt = Date.now();
      apiRequests.set(requestKey, requestInfo);

      // Continue with the request
      await route.continue();

      // Wait for response
      const response = await page.waitForResponse((res) => {
        const request = res.request();
        return res.url() === url && request.method() === method;
      });
      const endTime = Date.now();
      const duration = endTime - startTime;
      const status = response.status();
      const success = status >= 200 && status < 300;

      // Log API metrics
      console.log(`API Request: ${method} ${url}`, {
        status,
        duration,
        success,
        retryCount: requestInfo.count - 1
      });

      // Handle retries for failed requests
      if (!success && requestInfo.count <= MAX_RETRIES) {
        console.log(`Retrying failed request (${requestInfo.count}/${MAX_RETRIES}): ${method} ${url}`);
        // The request will be retried automatically due to the route handler
        return;
      }

    } catch (error) {
      console.error('Error handling API request:', error);
      // Continue with the request even if there's an error
      await route.continue();
    }
  };

  // Add route handler
  await page.route('**/api/**', routeHandler);

  try {
    // Collect performance metrics
    const performanceMetrics = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource');
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      
      return {
        resources: resources.map(entry => ({
          name: entry.name,
          duration: entry.duration,
          initiatorType: entry.initiatorType,
          transferSize: (entry as PerformanceResourceTiming).transferSize || 0,
          responseStatus: (entry as PerformanceResourceTiming).responseStatus || 0
        })),
        navigation: navigation ? {
          domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
          load: navigation.loadEventEnd - navigation.startTime,
          firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime || 0
        } : null
      };
    });

    // Update metrics with collected data
    metrics.resourceStats = {
      totalRequests: performanceMetrics.resources.length,
      failedRequests: performanceMetrics.resources.filter(r => r.responseStatus === 0).length,
      totalBytes: performanceMetrics.resources.reduce((sum, r) => sum + r.transferSize, 0),
      loadTime: Math.max(...performanceMetrics.resources.map(r => r.duration), 0)
    };

    if (performanceMetrics.navigation) {
      metrics.navigationStats = {
        domContentLoaded: performanceMetrics.navigation.domContentLoaded,
        load: performanceMetrics.navigation.load,
        firstPaint: performanceMetrics.navigation.firstPaint
      };
    }

    // Calculate test duration
    metrics.duration = Date.now() - startTime;

    // Collect test steps
    const steps = await page.evaluate(() => {
      const steps: TestStep[] = [];
      const elements = document.querySelectorAll('[data-test-step]');
      for (const element of elements) {
        steps.push({
          name: element.getAttribute('data-test-step') || '',
          duration: parseInt(element.getAttribute('data-test-duration') || '0', 10),
          status: element.getAttribute('data-test-status') || 'passed'
        });
      }
      return steps;
    });

    metrics.steps = steps;

  } catch (error) {
    console.error('Error collecting test metrics:', error);
    metrics.status = 'failed';
  } finally {
    // Remove route handler
    await page.unroute('**/api/**', routeHandler);
  }

  return metrics;
}