import type { Page, TestInfo } from '@playwright/test';
import type { TestMetrics, TestStep, ResourceMetrics, NavigationMetrics, AssertionMetrics } from '../types';
import fs from 'fs';

async function collectResourceMetrics(page: Page): Promise<ResourceMetrics> {
  return await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource');
    return {
      totalRequests: resources.length,
      failedRequests: 0,
      totalBytes: resources.reduce((acc, res) => acc + (res.transferSize || 0), 0),
      loadTime: Math.max(...resources.map(res => res.responseEnd)),
    };
  });
}

async function collectNavigationMetrics(page: Page): Promise<NavigationMetrics> {
  return await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
      load: navigation.loadEventEnd - navigation.startTime,
      firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime || 0,
    };
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

export async function collectTestMetrics(page: Page, testInfo: TestInfo, startTime: number): Promise<TestMetrics> {
  const endTime = Date.now();
  const duration = endTime - startTime;

  // Collect test steps
  const steps: TestStep[] = testInfo.titlePath.map(title => ({
    name: title,
    duration: 0, // We can't get individual step durations
    status: 'passed'
  }));

  // Collect resource metrics
  const resourceStats: ResourceMetrics = {
    totalRequests: 0,
    failedRequests: 0,
    totalBytes: 0,
    loadTime: 0
  };

  // Collect navigation metrics
  const navigationStats: NavigationMetrics = {
    domContentLoaded: 0,
    load: 0,
    firstPaint: 0
  };

  // Collect assertion metrics
  const assertions: AssertionMetrics = {
    total: testInfo.annotations.length,
    passed: testInfo.annotations.filter(a => a.type !== 'error').length,
    failed: testInfo.annotations.filter(a => a.type === 'error').length
  };

  try {
    // Get performance metrics from the page
    const performanceMetrics = await page.evaluate(() => {
      const timing = performance.timing;
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const resources = performance.getEntriesByType('resource');
      
      return {
        domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
        load: timing.loadEventEnd - timing.navigationStart,
        firstPaint: performance.getEntriesByType('paint')[0]?.startTime || 0,
        totalRequests: resources.length,
        failedRequests: resources.filter(r => r.duration === 0).length,
        totalBytes: resources.reduce((sum, r) => sum + (r as any).transferSize || 0, 0),
        loadTime: timing.loadEventEnd - timing.navigationStart
      };
    });

    resourceStats.totalRequests = performanceMetrics.totalRequests;
    resourceStats.failedRequests = performanceMetrics.failedRequests;
    resourceStats.totalBytes = performanceMetrics.totalBytes;
    resourceStats.loadTime = performanceMetrics.loadTime;

    navigationStats.domContentLoaded = performanceMetrics.domContentLoaded;
    navigationStats.load = performanceMetrics.load;
    navigationStats.firstPaint = performanceMetrics.firstPaint;
  } catch (error) {
    console.error('Error collecting performance metrics:', error);
  }

  // Map Playwright status to our status type
  const status = testInfo.status === 'passed' ? 'passed' :
                 testInfo.status === 'failed' ? 'failed' :
                 'skipped';

  const sanitizedTestInfo = sanitizeTestInfo(testInfo);
  fs.writeFileSync('testInfo.json', JSON.stringify(sanitizedTestInfo, null, 2));

  return {
    duration,
    status,
    name: testInfo.title,
    retries: testInfo.retry,
    steps,
    resourceStats,
    navigationStats,
    assertions,
    labels: {
      testId: testInfo.testId,
      testTitle: testInfo.title,
      timestamp: endTime,
      url: page.url()
    }
  };
}