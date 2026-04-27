import {
  trace,
  propagation,
  context as otelContext,
  SpanStatusCode,
  type Tracer,
  type Span,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import {
  W3CTraceContextPropagator,
  CompositePropagator,
  W3CBaggagePropagator,
} from "@opentelemetry/core";

/**
 * OpenTelemetry trace initialization (ADR 0012).
 *
 * `initTracing(name)` is idempotent: services call it once at
 * startup and the first caller wires the global tracer provider.
 * If `OTEL_EXPORTER_OTLP_ENDPOINT` is set, traces ship to the
 * configured OTLP collector via HTTP. Otherwise tracing is still
 * enabled for in-process span creation and trace-context
 * propagation — spans are dropped by a no-op exporter.
 *
 * The W3C trace-context propagator is installed globally so every
 * producer/consumer that uses `inject()` / `extract()` emits
 * `traceparent` headers. This is the mechanism the synthetic-kit
 * uses to push the trace into the target site.
 */

let initialized = false;
let tracer: Tracer | null = null;

export interface TracingConfig {
  service: string;
  version?: string;
  endpoint?: string;
  debug?: boolean;
}

export function initTracing(config: TracingConfig): Tracer {
  if (initialized && tracer) return tracer;

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: config.service,
      [SemanticResourceAttributes.SERVICE_VERSION]: config.version ?? "0.1.0",
    }),
  });

  const endpoint =
    config.endpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

  if (endpoint) {
    const exporter = new OTLPTraceExporter({ url: endpoint });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  } else if (config.debug) {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  );

  provider.register();
  initialized = true;
  tracer = trace.getTracer(config.service, config.version ?? "0.1.0");
  return tracer;
}

export function getTracer(): Tracer {
  if (!tracer) return trace.getTracer("insightview");
  return tracer;
}

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attrs?: Record<string, string | number | boolean>,
): Promise<T> {
  const t = getTracer();
  return t.startActiveSpan(name, async (span) => {
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        span.setAttribute(k, v);
      }
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Inject the active trace context into a headers object. Used by
 * the event bus to propagate traces across async hops.
 */
export function injectTraceHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  propagation.inject(otelContext.active(), headers, {
    set: (carrier, key, value) => {
      (carrier as Record<string, string>)[key] = String(value);
    },
  });
  return headers;
}

/**
 * Extract a trace context from incoming headers. Callers wrap
 * their handler in `otelContext.with(ctx, ...)` to activate it.
 */
export function extractTraceContext(
  headers: Record<string, string | string[] | undefined>,
) {
  return propagation.extract(otelContext.active(), headers, {
    get: (carrier, key) => {
      const value = (
        carrier as Record<string, string | string[] | undefined>
      )[key];
      if (Array.isArray(value)) return value[0];
      return value;
    },
    keys: (carrier) =>
      Object.keys(carrier as Record<string, unknown>),
  });
}

export { trace, propagation, otelContext, SpanStatusCode };
