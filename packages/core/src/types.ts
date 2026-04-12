/**
 * Lightweight value types shared across services. Keep this file free of
 * any framework imports so it can be used from the browser SDK too.
 */

export interface WebVitalSnapshot {
  cls?: number;
  fcp?: number;
  fid?: number;
  inp?: number;
  lcp?: number;
  ttfb?: number;
}

export interface ResourceStats {
  totalRequests: number;
  failedRequests: number;
  totalBytes: number;
  loadTime: number;
}

export interface NavigationStats {
  domContentLoaded: number;
  load: number;
  firstPaint: number;
}

export interface AssertionStats {
  total: number;
  passed: number;
  failed: number;
}

export interface AssertionSpec {
  type: "status" | "title-contains" | "body-contains" | "max-duration-ms";
  value: string;
}

export interface CheckSpec {
  name: string;
  description?: string;
  type: "browser" | "api" | "tcp";
  enabled?: boolean;
  schedule: string;
  targetUrl: string;
  timeoutMs?: number;
  retries?: number;
  locations?: string[];
  scriptRef?: string;
  assertions?: AssertionSpec[];
  tags?: string[];
}

export interface AlertRuleSpec {
  name: string;
  checkName?: string;
  strategy: "THRESHOLD" | "CONSECUTIVE_FAILURES" | "COMPOSITE";
  expression: Record<string, unknown>;
  severity: "INFO" | "WARNING" | "CRITICAL";
  cooldownSeconds?: number;
  channels?: string[];
  enabled?: boolean;
}
