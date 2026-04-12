// Re-export collector functions under stable names so runCheck.ts
// doesn't depend on the registry lookup path. Keeping this thin
// module means tests can import individual collector fns directly.
export { collectNavigationTiming as collectNavigationTimingFn } from "./navigationTiming.js";
export { collectResourceStats as collectResourceStatsFn } from "./resourceStats.js";
export { collectCdpMetrics as collectCdpMetricsFn } from "./cdpMetrics.js";
