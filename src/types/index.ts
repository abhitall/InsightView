import type { Metric } from 'web-vitals';
import type { TestInfo } from '@playwright/test';

export type WebVitalMetricName = 
  | 'CLS' 
  | 'FCP' 
  | 'FID' 
  | 'INP' 
  | 'LCP' 
  | 'TTFB'
  | 'RESOURCE_TIMING'
  | 'NAVIGATION_TIMING';

export type MetricRating = 'good' | 'needs-improvement' | 'poor' | 'neutral';

export interface ResourceEntry {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
  requestStart?: number;
  responseEnd?: number;
}

// Base metric interface without entries
interface BaseMetric extends Omit<Metric, 'name' | 'rating' | 'entries'> {
  name: WebVitalMetricName;
  rating: MetricRating;
}

// Extended metric interface with optional custom entries
export interface ExtendedMetric extends BaseMetric {
  entries?: ResourceEntry[];
}

export interface WebVitalsData {
  metrics: Metric[];
  timestamp: number;
  url: string;
  testId: TestInfo['testId'];
  testTitle: string;
  pageIndex: number;
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
  status: 'passed' | 'failed' | 'skipped';
  name: string;
  retries: number;
  url: string;
  startTime: number;
  endTime: number;
  testId: TestInfo['testId'];
  testTitle: string;
  timestamp: number;
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
  webVitals: WebVitalsData[];
  testMetrics: TestMetrics;
  timestamp: number;
  environment: {
    userAgent: string;
    viewport: {
      width: number;
      height: number;
    };
    browser: {
      name: string;
      version: string;
      device: string;
    };
  };
}