import type { Metric } from 'web-vitals';
import { WEB_VITALS_METRICS, TEST_METRIC_CATEGORIES } from './constants';

export type WebVitalMetricName = typeof WEB_VITALS_METRICS[number];
export type TestMetricCategory = typeof TEST_METRIC_CATEGORIES[keyof typeof TEST_METRIC_CATEGORIES];

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

export interface TestMetrics {
  duration: number;
  status: string;
  name: string;
  retries: number;
  steps: TestStep[];
  resourceStats: {
    totalRequests: number;
    failedRequests: number;
    totalBytes: number;
    loadTime: number;
  };
  navigationStats: {
    domContentLoaded: number;
    load: number;
    firstPaint: number;
  };
  assertions: {
    total: number;
    passed: number;
    failed: number;
  };
}

export interface MonitoringReport {
  webVitals: WebVitalsData;
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