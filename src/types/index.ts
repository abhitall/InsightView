import type { Metric } from 'web-vitals';
import type { TestInfo } from '@playwright/test';

export type WebVitalMetricName = 'CLS' | 'FCP' | 'FID' | 'INP' | 'LCP' | 'TTFB';

export interface WebVitalsData {
  metrics: Metric[];
  timestamp: number;
  url: string;
}

export interface TestStep {
  name: string;
  duration: number;
  status: string;
}

export interface ResourceMetrics {
  totalRequests: number;
  failedRequests: number;
  totalBytes: number;
  loadTime: number;
}

export interface NavigationMetrics {
  domContentLoaded: number;
  load: number;
  firstPaint: number;
}

export interface AssertionMetrics {
  total: number;
  passed: number;
  failed: number;
}

export interface TestMetrics {
  duration: number;
  status: string;
  name: string;
  retries: number;
  steps: TestStep[];
  resourceStats: ResourceMetrics;
  navigationStats: NavigationMetrics;
  assertions: AssertionMetrics;
}

export interface BrowserInfo {
  name: string;
  version: string;
  device: string;
}

export interface ViewportInfo {
  width: number;
  height: number;
}

export interface MonitoringReport {
  webVitals: WebVitalsData | WebVitalsData[];  // Updated to support single or multiple pages
  testMetrics: TestMetrics;
  timestamp: number;
  environment: {
    userAgent: string;
    viewport: ViewportInfo;
    browser: BrowserInfo;
  };
}