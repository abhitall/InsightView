import type { Page, TestInfo } from '@playwright/test';
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
  return await page.evaluate(() => {
    const requests = performance.getEntriesByType('resource')
      .filter(entry => {
        const url = (entry as PerformanceResourceTiming).name;
        return url.startsWith('http') && !url.includes(window.location.host);
      })
      .map(entry => {
        const resource = entry as PerformanceResourceTiming;
        const request = (window as any).__apiRequests?.[resource.name] || {};
        
        return {
          endpoint: resource.name,
          method: request.method || 'GET',
          statusCode: resource.responseStatus || 0,
          duration: resource.duration,
          success: resource.duration > 0,
          responseSize: resource.transferSize || resource.encodedBodySize,
          timestamp: resource.startTime,
          requestHeaders: request.headers,
          responseHeaders: request.responseHeaders,
          responseData: request.responseData,
          requestBody: request.body,
          retryCount: request.retryCount,
          retryDelay: request.retryDelay
        };
      });
    return requests;
  });
}

export async function collectTestMetrics(page: Page, testInfo: TestInfo, startTime: number): Promise<TestMetrics> {
  const endTime = Date.now();
  const duration = endTime - startTime;

  console.log(`Collecting test metrics for: ${testInfo.title}`);
  console.log(`Test duration: ${duration}ms`);

  // Collect test steps with estimated durations
  const stepCount = testInfo.titlePath.length;
  const estimatedStepDuration = Math.floor(duration / stepCount);
  const steps: TestStep[] = testInfo.titlePath.map((title, index) => {
    const isLastStep = index === stepCount - 1;
    const stepDuration = isLastStep ? duration - (estimatedStepDuration * (stepCount - 1)) : estimatedStepDuration;
    return {
      name: title,
      duration: stepDuration,
      status: testInfo.status === 'passed' ? 'passed' : 'failed'
    };
  });

  console.log(`Collected ${steps.length} test steps`);

  // Collect resource and navigation metrics using helper functions
  let resourceStats: ResourceMetrics;
  let navigationStats: NavigationMetrics;

  try {
    [resourceStats, navigationStats] = await Promise.all([
      collectResourceMetrics(page),
      collectNavigationMetrics(page)
    ]);
  } catch (error) {
    console.error('Error collecting performance metrics:', error);
    resourceStats = {
      totalRequests: 0,
      failedRequests: 0,
      totalBytes: 0,
      loadTime: 0
    };
    navigationStats = {
      domContentLoaded: 0,
      load: 0,
      firstPaint: 0
    };
  }

  // Collect API metrics if available
  let apiMetrics: ApiMetrics[] | undefined;
  try {
    // Set up API request tracking
    await page.evaluate(() => {
      if (!(window as any).__apiRequests) {
        (window as any).__apiRequests = {};
        
        // Intercept fetch requests
        const originalFetch = window.fetch;
        window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
          const startTime = performance.now();
          let retryCount = 0;
          let retryDelay = 0;
          
          while (true) {
            try {
              const response = await originalFetch(input, init);
              const endTime = performance.now();
              
              // Store request details
              const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
              (window as any).__apiRequests[url] = {
                method: init?.method || 'GET',
                headers: init?.headers,
                body: init?.body,
                retryCount,
                retryDelay,
                responseHeaders: Object.fromEntries(response.headers.entries()),
                responseData: await response.clone().json().catch(() => null)
              };
              
              return response;
            } catch (error) {
              retryCount++;
              if (retryCount >= 3) throw error;
              retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
          }
        };
      }
    });

    const apiRequests = await collectApiMetrics(page);
    if (apiRequests.length > 0) {
      apiMetrics = apiRequests;
      console.log(`Collected ${apiRequests.length} API metrics with response data`);
    }
  } catch (error) {
    console.error('Error collecting API metrics:', error);
  }

  // Collect assertion metrics
  const assertions: AssertionMetrics = {
    total: testInfo.annotations.length,
    passed: testInfo.annotations.filter(a => a.type !== 'error').length,
    failed: testInfo.annotations.filter(a => a.type === 'error').length
  };

  console.log(`Assertion metrics: ${assertions.total} total, ${assertions.passed} passed, ${assertions.failed} failed`);

  // Map Playwright status to our status type
  const status = testInfo.status === 'passed' ? 'passed' :
                 testInfo.status === 'failed' ? 'failed' :
                 'skipped';

  // Save sanitized test info for debugging
  const sanitizedTestInfo = sanitizeTestInfo(testInfo);
  fs.writeFileSync('testInfo.json', JSON.stringify(sanitizedTestInfo, null, 2));

  const metrics: TestMetrics = {
    duration,
    status,
    name: testInfo.title,
    retries: testInfo.retry,
    steps,
    resourceStats,
    navigationStats,
    assertions,
    apiMetrics,
    labels: {
      testId: testInfo.testId,
      testTitle: testInfo.title,
      timestamp: endTime,
      url: page.url()
    }
  };

  console.log('Test metrics collection complete');
  return metrics;
}