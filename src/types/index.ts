import type { Metric } from 'web-vitals';
import type { TestInfo, Page } from '@playwright/test';

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

export type AlertRisk = 'High' | 'Medium' | 'Low' | 'Informational';
export type AlertConfidence = 'High' | 'Medium' | 'Low' | 'Confirmed';

export interface ZAPAlert {
  risk: AlertRisk;
  confidence: AlertConfidence;
  url: string;
  name: string;
  description: string;
  solution: string;
  reference: string;
  param: string;
  attack: string;
  evidence: string;
  cweId: string;
  wascId: string;
  scanId?: number;
  pluginId?: string;
  other?: Record<string, string>;
}

export interface ZAPScanStats {
  totalUrls: number;
  uniqueUrls: number;
  requestCount: number;
  alertsByRisk: Record<AlertRisk, number>;
  timeMetrics: {
    spiderDuration: number;
    ajaxSpiderDuration: number;
    activeScanDuration: number;
    totalDuration: number;
  };
}

export interface ZAPScanResult {
  scanId: number;
  duration: number;
  timestamp: string;
  targetUrl: string;
  scanType: 'quick' | 'full';
  contextName: string;
  status: 'completed' | 'failed';
  stats: ZAPScanStats;
  alerts: ZAPAlert[];
  errors?: Array<{ phase: string; message: string; timestamp: string }>;
  errorReport?: string;
}

export interface ZapResponse<T> {
  code?: string;
  message?: string;
  alerts?: T[];
}

export interface ZapRequestConfig {
  timeout?: number;
  responseEncoding?: string;
  validateStatus?: (status: number) => boolean;
}

export interface ZAPScanOptions {
  authHeaders: Record<string, string>;
  maxRequestsPerSecond: number;
  maxScanDuration: number;
  failOnHighRisks: boolean;
  excludeUrls?: string[];
  includeUrls?: string[];
  scanPolicyName?: string;
  threadCount?: number;
}

export interface MonitoringOptions {
  pages?: Page[];
  securityScan?: boolean;
  isFullScan?: boolean;
  scanOptions?: Partial<ZAPScanOptions>;
}

export interface MonitoringReport {
  webVitals: WebVitalsData | WebVitalsData[];
  testMetrics: TestMetrics;
  timestamp: number;
  environment: {
    userAgent: string;
    viewport: ViewportInfo;
    browser: BrowserInfo;
  };
  zapScan?: ZAPScanResult;
}

export interface ZapClientOptions {
  apiKey?: string;
  proxy?: string;
  rejectUnauthorized?: boolean;
  requestConfig?: ZapRequestConfig;
}

export interface ZapClient {
  core: {
    version(): Promise<string>;
    urls(): Promise<string[]>;
    newMessage(): Promise<string>;
    messageResponse(messageId: string): Promise<any>;
    messageResponseStatusCode(messageId: string): Promise<number>;
    setOptionDefaultHeader(header: string): Promise<void>;
    setOptionHttpStateEnabled(enabled: boolean): Promise<void>;
    setOptionFollowRedirects(follow: boolean): Promise<void>;
    setOptionHandleAntiCSRFTokens(handle: boolean): Promise<void>;
    setOptionHostPerScan(count: number): Promise<void>;
    setOptionThreadPerHost(count: number): Promise<void>;
    setOptionMaxResponseSize(size: number): Promise<void>;
    setOptionSingleCookieRequestHeader(enabled: boolean): Promise<void>;
    setOptionUseHttpState(enabled: boolean): Promise<void>;
    numberOfMessages(options: { baseurl: string }): Promise<string>;
    alertsByContext(contextName: string): Promise<any[]>;
  };
  context: {
    newContext(name: string): Promise<void>;
    includeInContext(contextName: string, regex: string): Promise<void>;
    excludeFromContext(contextName: string, regex: string): Promise<void>;
    setContextInScope(contextName: string, inScope: boolean): Promise<void>;
    removeContext(contextName: string): Promise<void>;
  };
  spider: {
    scan(url: string, maxChildren?: number | undefined, recurse?: boolean, contextName?: string, subtreeOnly?: boolean): Promise<string>;
    status(scanId: string): Promise<string>;
    setOptionMaxDuration(duration: number): Promise<void>;
    setOptionDelayInMs(delay: number): Promise<void>;
    setOptionMaxParseSizeBytes(size: number): Promise<void>;
  };
  ajaxSpider: {
    scan(url: string, inScope: boolean, contextName: string, subtreeOnly: boolean): Promise<void>;
    status(): Promise<string>;
    setOptionMaxCrawlDepth(depth: number): Promise<void>;
    setOptionMaxDuration(duration: number): Promise<void>;
  };
  ascan: {
    scan(url: string, recurse: boolean, inScopeOnly: boolean, scanPolicyName: string, method?: string, postData?: string, options?: Record<string, any>): Promise<string>;
    status(scanId: string): Promise<string>;
    setOptionDelayInMs(delay: number): Promise<void>;
    setOptionMaxScanDurationInMins(duration: number): Promise<void>;
  };
  httpsessions: {
    createEmptySession(site: string, sessionName: string): Promise<void>;
    setActiveSession(site: string, sessionName: string): Promise<void>;
    addSessionToken(contextName: string, sessionToken: string): Promise<void>;
  };
  sessionManagement: {
    setSessionManagementMethod(contextId: string, methodName: string, methodConfigParams?: string | null): Promise<void>;
  };
}