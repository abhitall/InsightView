import type { CheckRunStatus, Severity, TriggerSource, RumEventType } from "./enums.js";

/**
 * Event bus message envelope. Every message published on the bus is
 * wrapped in this envelope so consumers have stable metadata regardless
 * of bus implementation (BullMQ today, Kafka tomorrow).
 */
export interface Envelope<TPayload> {
  id: string;
  type: string;
  version: 1;
  occurredAt: string;
  tenantId: string;
  traceId?: string;
  payload: TPayload;
}

// ---- Topic constants ----

export const Topics = {
  ChecksScheduled: "checks.scheduled",
  ChecksStarted: "checks.started",
  ChecksCompleted: "checks.completed",
  AlertsTriggered: "alerts.triggered",
  AlertsResolved: "alerts.resolved",
  RumEventsIngested: "rum.events.ingested",
} as const;

// ---- Message type strings (for envelope.type) ----

export const MessageTypes = {
  CheckScheduled: "CheckScheduled",
  CheckStarted: "CheckStarted",
  CheckCompleted: "CheckCompleted",
  AlertTriggered: "AlertTriggered",
  AlertResolved: "AlertResolved",
  RumEventIngested: "RumEventIngested",
} as const;

// ---- Payload shapes ----

export interface CheckScheduledPayload {
  runId: string;
  checkId: string;
  checkName: string;
  scheduledAt: string;
  targetUrl: string;
  scriptRef?: string | null;
  timeoutMs: number;
  retries: number;
  triggeredBy: TriggerSource;
  assertions: Array<{ type: string; value: string }>;
}

export interface CheckStartedPayload {
  runId: string;
  checkId: string;
  runnerId: string;
  startedAt: string;
}

export interface CheckCompletedPayload {
  runId: string;
  checkId: string;
  status: CheckRunStatus;
  completedAt: string;
  durationMs: number;
  resultIds: string[];
  summary: {
    passedAssertions: number;
    failedAssertions: number;
    webVitals: Record<string, number>;
  };
  errorMessage?: string | null;
}

export interface AlertTriggeredPayload {
  incidentId: string;
  ruleId: string;
  ruleName: string;
  checkId?: string | null;
  runId?: string | null;
  severity: Severity;
  openedAt: string;
  snapshot: Record<string, unknown>;
}

export interface AlertResolvedPayload {
  incidentId: string;
  ruleId: string;
  resolvedAt: string;
}

export interface RumEventIngestedPayload {
  eventId: string;
  sessionId: string;
  siteId: string;
  type: RumEventType;
  receivedAt: string;
}

// Helper to construct envelopes with ergonomic defaults.
export function envelope<T>(
  type: string,
  payload: T,
  opts: { tenantId: string; id?: string; traceId?: string },
): Envelope<T> {
  return {
    id: opts.id ?? crypto.randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId,
    traceId: opts.traceId,
    payload,
  };
}
