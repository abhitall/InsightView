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
          requestBody: postData ? JSON.parse(postData) : undefined,
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
  const endTime = Date.now();
  const duration = endTime - startTime;

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

  // Collect resource and navigation metrics using helper functions
  let resourceStats: ResourceMetrics;
  let navigationStats: NavigationMetrics;
  let apiMetrics: ApiMetrics[] | undefined;

  try {
    // Start API metrics collection
    const apiMetricsPromise = collectApiMetrics(page);
    
    // Collect other metrics in parallel
    [resourceStats, navigationStats, apiMetrics] = await Promise.all([
      collectResourceMetrics(page),
      collectNavigationMetrics(page),
      apiMetricsPromise
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

  // Collect assertion metrics
  const assertions: AssertionMetrics = {
    total: testInfo.annotations.length,
    passed: testInfo.annotations.filter(a => a.type !== 'error').length,
    failed: testInfo.annotations.filter(a => a.type === 'error').length
  };

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

  return metrics;
}