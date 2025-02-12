import type { Page, TestInfo } from '@playwright/test';
import type { TestMetrics, ResourceMetrics, NavigationMetrics } from '../types';
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
  const [resourceStats, navigationStats] = await Promise.all([
    collectResourceMetrics(page),
    collectNavigationMetrics(page),
  ]);

  const sanitizedTestInfo = sanitizeTestInfo(testInfo);
  fs.writeFileSync('testInfo.json', JSON.stringify(sanitizedTestInfo, null, 2));

  return {
    duration: Date.now() - startTime,
    status: testInfo.status || 'unknown',
    name: testInfo.title,
    retries: testInfo.retry,
    steps: testInfo.titlePath.map(title => ({
      name: title,
      duration: 0, // We can't get individual step durations from titlePath
      status: 'unknown',
    })),
    resourceStats,
    navigationStats,
    assertions: {
      total: testInfo.errors.length,
      passed: testInfo.status === 'passed' ? 1 : 0,
      failed: testInfo.status === 'failed' ? 1 : 0,
    },
  };
}