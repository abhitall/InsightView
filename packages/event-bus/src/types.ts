import type { Envelope } from "@insightview/core";

/**
 * EventBus is the seam that ADR 0002 calls out as "must not leak
 * implementation details". The contract below is deliberately narrower
 * than BullMQ's queue API so that a Kafka-backed implementation can
 * satisfy it without wrapping consumers in compensating code.
 *
 * Stable rules:
 *  1. Message envelopes are immutable and carry their own id + version.
 *  2. Ordering is per-key only; consumers must not assume global order.
 *  3. Subscribers must be idempotent; dedupe at the application layer.
 *  4. Cron scheduling is NOT part of this interface — it belongs to
 *     RepeatingJobScheduler so the Kafka swap is topic-only.
 */

export interface PublishOptions {
  /** Stable key for dedupe (e.g., runId). BullMQ uses it as jobId,
   *  Kafka will use it as partition key. */
  dedupeKey?: string;
  /** Delay publication by N ms. */
  delayMs?: number;
}

export interface SubscribeOptions {
  /** Maximum concurrent in-flight messages per worker. */
  concurrency?: number;
  /** Consumer group identifier (ignored by BullMQ, used by Kafka). */
  group?: string;
}

export interface Subscription {
  close(): Promise<void>;
}

export type Handler<T> = (msg: Envelope<T>) => Promise<void>;

export interface EventBus {
  publish<T>(
    topic: string,
    msg: Envelope<T>,
    opts?: PublishOptions,
  ): Promise<void>;
  subscribe<T>(
    topic: string,
    handler: Handler<T>,
    opts?: SubscribeOptions,
  ): Promise<Subscription>;
  healthcheck(): Promise<{ ok: boolean; backend: string }>;
  close(): Promise<void>;
}

export interface RepeatingJobScheduler {
  /** Idempotent register of a cron schedule. Calling twice with the same
   *  key replaces the previous schedule. */
  upsertSchedule(opts: {
    key: string;
    topic: string;
    cron: string;
    payload: unknown;
    tenantId: string;
  }): Promise<void>;
  /** Remove a schedule registered by key. */
  removeSchedule(key: string): Promise<void>;
  /** List all registered schedules. */
  listSchedules(): Promise<Array<{ key: string; cron: string }>>;
  close(): Promise<void>;
}
