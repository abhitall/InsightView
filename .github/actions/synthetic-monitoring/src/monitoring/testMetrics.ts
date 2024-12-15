import { Page, TestInfo } from '@playwright/test';
import { TestMetrics } from '../types';

export async function collectTestMetrics(page: Page, testInfo: TestInfo, startTime: number): Promise<TestMetrics> {
  const performanceMetrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType('resource');
    
    return {
      navigationStats: {
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
        load: navigation.loadEventEnd - navigation.startTime,
        firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime || 0,
      },
      resourceStats: {
        totalRequests: resources.length,
        failedRequests: 0,
        totalBytes: resources.reduce((acc, res) => acc + (res.transferSize || 0), 0),
        loadTime: Math.max(...resources.map(res => res.responseEnd)),
      },
    };
  });

  const steps = testInfo.steps.map(step => ({
    name: step.title,
    duration: step.duration,
    status: step.error ? 'failed' : 'passed',
  }));

  return {
    duration: Date.now() - startTime,
    status: testInfo.status,
    name: testInfo.title,
    retries: testInfo.retry,
    steps,
    resourceStats: performanceMetrics.resourceStats,
    navigationStats: performanceMetrics.navigationStats,
    assertions: {
      total: testInfo.expectedStatuses?.length || 0,
      passed: testInfo.expectedStatuses?.filter(s => s.passed).length || 0,
      failed: testInfo.expectedStatuses?.filter(s => !s.passed).length || 0,
    },
  };
}