import { randomUUID } from "node:crypto";

/**
 * ID helpers. UUIDv4 is used everywhere; Prisma generates its own cuids
 * for primary keys but services often need to generate IDs on their side
 * (run_id, event_id) so they can reference the row idempotently before
 * the DB insert returns.
 */

export function createRunId(): string {
  return `run_${randomUUID()}`;
}

export function createEventId(): string {
  return `evt_${randomUUID()}`;
}

export function createIncidentId(): string {
  return `inc_${randomUUID()}`;
}

export function createSessionId(): string {
  return randomUUID();
}
