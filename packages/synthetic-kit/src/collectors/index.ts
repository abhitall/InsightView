import type { Page } from "playwright";
import type { WebVitals, NavigationTiming, ResourceStats, CdpMetrics } from "../types.js";
import { collectWebVitals } from "./webVitals.js";
import { collectNavigationTiming } from "./navigationTiming.js";
import { collectResourceStats } from "./resourceStats.js";
import { collectCdpMetrics } from "./cdpMetrics.js";

/**
 * Collector strategy interface. Each collector is a pure function
 * that takes a loaded Page and returns a partial metrics object.
 * Collectors must NEVER throw — they return empty results on failure
 * so the runCheck orchestrator can still emit a partial-success
 * envelope rather than losing the entire run.
 */
export interface Collector<T> {
  readonly name: string;
  collect(page: Page): Promise<T>;
}

const registry = new Map<string, Collector<unknown>>();

export function registerCollector(collector: Collector<unknown>): void {
  registry.set(collector.name, collector);
}

export function collectorFor(name: string): Collector<unknown> | undefined {
  return registry.get(name);
}

// ---- Built-in collectors ----

export const webVitalsCollector: Collector<WebVitals> = {
  name: "web-vitals",
  collect: collectWebVitals,
};

export const navigationTimingCollector: Collector<NavigationTiming> = {
  name: "navigation-timing",
  collect: collectNavigationTiming,
};

export const resourceStatsCollector: Collector<ResourceStats> = {
  name: "resource-stats",
  collect: collectResourceStats,
};

export const cdpMetricsCollector: Collector<CdpMetrics> = {
  name: "cdp-metrics",
  collect: collectCdpMetrics,
};

registerCollector(webVitalsCollector as Collector<unknown>);
registerCollector(navigationTimingCollector as Collector<unknown>);
registerCollector(resourceStatsCollector as Collector<unknown>);
registerCollector(cdpMetricsCollector as Collector<unknown>);
