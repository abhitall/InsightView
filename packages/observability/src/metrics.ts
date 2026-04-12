import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from "prom-client";

/**
 * Shared Prometheus registry factory. Each service owns its own registry
 * instance so that tests can fully reset between runs.
 */
export function createRegistry(serviceName: string): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });
  collectDefaultMetrics({ register: registry });
  return registry;
}

export function createHttpHistogram(registry: Registry): Histogram<string> {
  return new Histogram({
    name: "insightview_http_request_duration_ms",
    help: "HTTP request duration in ms",
    labelNames: ["method", "route", "status_code"],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [registry],
  });
}

export function createBusCounter(registry: Registry): Counter<string> {
  return new Counter({
    name: "insightview_event_bus_messages_total",
    help: "Messages processed by the event bus",
    labelNames: ["topic", "outcome"],
    registers: [registry],
  });
}

export function createWatchdogGauge(registry: Registry): Gauge<string> {
  return new Gauge({
    name: "insightview_watchdog_age_seconds",
    help: "Age of the latest watchdog heartbeat in seconds",
    labelNames: ["scope"],
    registers: [registry],
  });
}

export { Registry, Counter, Histogram, Gauge };
