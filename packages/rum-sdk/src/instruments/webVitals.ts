import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type CLSMetricWithAttribution,
  type FCPMetricWithAttribution,
  type INPMetricWithAttribution,
  type LCPMetricWithAttribution,
  type TTFBMetricWithAttribution,
} from "web-vitals/attribution";
import type { RumEventInput } from "../types.js";

type Push = (ev: RumEventInput) => void;

type AnyAttributionMetric =
  | CLSMetricWithAttribution
  | FCPMetricWithAttribution
  | INPMetricWithAttribution
  | LCPMetricWithAttribution
  | TTFBMetricWithAttribution;

/**
 * Install Core Web Vitals collection using the `web-vitals/attribution`
 * build so each metric carries diagnostic attribution data (slow element,
 * long-task source, time-to-first-byte breakdown, ...). Emitted as a
 * RUM_EVENT with `attributes.attribution` so the collector can persist
 * the root-cause hint alongside the metric value.
 */
export function installWebVitals(push: Push): void {
  const emit = (
    name: string,
    metric: AnyAttributionMetric,
  ) => {
    push({
      id: (crypto as Crypto).randomUUID(),
      type: "WEB_VITAL",
      name,
      value: metric.value,
      rating: metric.rating as
        | "good"
        | "needs-improvement"
        | "poor"
        | undefined,
      url: location.href,
      occurredAt: new Date().toISOString(),
      attributes: {
        navigationType: metric.navigationType,
        // The full attribution object is small and serializable;
        // the collector can decide what to keep / hash for privacy.
        attribution: metric.attribution as unknown as Record<string, unknown>,
      },
    });
  };
  onCLS((m) => emit("CLS", m));
  onFCP((m) => emit("FCP", m));
  onINP((m) => emit("INP", m));
  onLCP((m) => emit("LCP", m));
  onTTFB((m) => emit("TTFB", m));
}
