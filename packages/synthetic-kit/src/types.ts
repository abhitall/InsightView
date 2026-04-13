/**
 * Core types for the Actions-native synthetic monitoring kit.
 *
 * The envelope and spec types are the stable public API. Collectors,
 * auth strategies, exporters, and network profiles are all strategies
 * that plug into the `runCheck` orchestrator via registries.
 */

export const ErrorCategory = {
  /** The target's dependencies (DNS, TCP, TLS) are unreachable. */
  TARGET_DOWN: "TARGET_DOWN",
  /** The target responded but returned an unexpected status/content. */
  TARGET_ERROR: "TARGET_ERROR",
  /** Our own tooling failed (Playwright crash, disk full, panic). */
  INFRA_FAILURE: "INFRA_FAILURE",
  /** The check partially succeeded — some metrics collected, some failed. */
  PARTIAL: "PARTIAL",
} as const;
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const RunStatus = {
  PASSED: "PASSED",
  FAILED: "FAILED",
  PARTIAL: "PARTIAL",
  ERROR: "ERROR",
  TIMEOUT: "TIMEOUT",
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export interface WebVitals {
  LCP?: number;
  CLS?: number;
  FCP?: number;
  TTFB?: number;
  INP?: number;
  FID?: number;
}

export interface NavigationTiming {
  ttfb?: number;
  fcp?: number;
  dnsLookup?: number;
  tlsTime?: number;
  domContentLoaded?: number;
  pageLoad?: number;
  transferSize?: number;
  protocol?: string;
}

export interface ResourceStats {
  totalRequests: number;
  failedRequests: number;
  totalBytes: number;
}

export interface CdpMetrics {
  jsHeapUsedSize?: number;
  jsHeapTotalSize?: number;
  layoutCount?: number;
  scriptDuration?: number;
}

export interface AssertionResult {
  type: string;
  value: string;
  passed: boolean;
  detail?: string;
}

export interface MonitorStep {
  /** Human label — appears in artifacts and logs. */
  name: string;
  /** Absolute URL to navigate to. */
  url: string;
  /** Additional wait hints for SPAs. */
  waitFor?: {
    selector?: string;
    networkIdle?: boolean;
    timeoutMs?: number;
  };
  /** Per-step assertion overrides. If omitted, uses monitor-level assertions. */
  assertions?: Array<{ type: string; value: string }>;
}

export interface MonitorSpec {
  name: string;
  description?: string;
  targetUrl: string;
  timeoutMs?: number;
  retries?: number;
  scriptRef?: string;
  assertions?: Array<{ type: string; value: string }>;
  tags?: string[];
  steps?: MonitorStep[];
  /** How to authenticate before the first step. */
  auth?: {
    strategy: string;
    config: Record<string, unknown>;
  };
  /** Network profile (direct, proxy, mtls). */
  network?: {
    profile: string;
    config?: Record<string, unknown>;
  };
  /** Exporters to invoke after the run completes. */
  exporters?: Array<{ type: string; config?: Record<string, unknown> }>;
  /** Consent cookies to pre-set before navigation. */
  preCookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
}

export interface CdnCacheInfo {
  /** HIT | MISS | UNKNOWN derived from cf-cache-status, x-cache, etc. */
  status: "HIT" | "MISS" | "UNKNOWN";
  source?: string;
  raw?: string;
  age?: number;
}

export interface StepResult {
  name: string;
  url: string;
  durationMs: number;
  status: "passed" | "failed" | "error" | "partial";
  statusCode?: number;
  cdnCache?: CdnCacheInfo;
  flaky?: boolean;
  attempts?: number;
  webVitals: WebVitals;
  navigationTiming: NavigationTiming;
  resourceStats: ResourceStats;
  cdpMetrics: CdpMetrics;
  assertions: AssertionResult[];
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  screenshotPath?: string;
  tracePath?: string;
}

export interface ResultEnvelope {
  /** UUID */
  runId: string;
  monitor: string;
  tenantId: string;
  location: string;
  status: RunStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  steps: StepResult[];
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    webVitals: WebVitals;
    totalRequests: number;
    failedRequests: number;
    passedAssertions: number;
    failedAssertions: number;
  };
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  githubContext?: {
    runId?: string;
    runAttempt?: string;
    repository?: string;
    workflow?: string;
    actor?: string;
    ref?: string;
    sha?: string;
  };
}
