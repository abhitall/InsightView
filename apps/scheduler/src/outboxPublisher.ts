import type { Logger } from "@insightview/observability";
import type { EventBus } from "@insightview/event-bus";
import { envelope, type Envelope } from "@insightview/core";
import {
  listUnpublishedEvents,
  markPublished,
  reapOldEvents,
} from "@insightview/db";

/**
 * Outbox publisher loop (ADR 0010). Polls the DomainEvent table
 * every tick, publishes unpublished rows to the event bus, then
 * flips `publishedAt`. Runs on the leader-elected scheduler so
 * there's exactly one publisher in the cluster.
 *
 * Failure modes and how we handle them:
 *
 *   - Bus unreachable at publish time: rows stay with
 *     publishedAt = NULL and the next tick retries. At-least-once
 *     delivery via retry.
 *
 *   - Bus publishes but we crash before marking published: the
 *     next tick re-publishes. Consumers are idempotent (ADR 0002
 *     + application-layer CheckRun.status checks) so duplicates
 *     are safe.
 *
 *   - Row buildup under high throughput: the periodic reaper
 *     trims rows older than `retentionMs` (default 7 days).
 */

export interface OutboxPublisherOpts {
  bus: EventBus;
  log: Logger;
  isLeader: () => boolean;
  intervalMs?: number;
  batchSize?: number;
  retentionMs?: number;
  reapIntervalMs?: number;
}

export function startOutboxPublisher(
  opts: OutboxPublisherOpts,
): () => void {
  const interval = opts.intervalMs ?? 1_500;
  const batchSize = opts.batchSize ?? 200;
  const retentionMs = opts.retentionMs ?? 7 * 24 * 60 * 60 * 1000;
  const reapIntervalMs = opts.reapIntervalMs ?? 15 * 60 * 1000;

  let stopped = false;
  let lastReap = 0;

  const tick = async () => {
    if (stopped) return;
    if (!opts.isLeader()) return;

    try {
      const pending = await listUnpublishedEvents(batchSize);
      if (pending.length === 0) return;

      const publishedIds: string[] = [];
      for (const row of pending) {
        try {
          const env: Envelope<unknown> = envelope(row.type, row.payload, {
            id: row.id,
            tenantId: row.tenantId,
            traceId: row.traceId ?? undefined,
          });
          await opts.bus.publish(row.topic, env, { dedupeKey: row.id });
          publishedIds.push(row.id);
        } catch (err) {
          opts.log.warn(
            { err, id: row.id, topic: row.topic },
            "outbox publish failed; will retry",
          );
        }
      }
      if (publishedIds.length > 0) {
        await markPublished(publishedIds);
        opts.log.debug?.(
          { published: publishedIds.length },
          "outbox flush",
        );
      }
    } catch (err) {
      opts.log.error({ err }, "outbox publisher tick failed");
    }

    // Periodic reap.
    if (Date.now() - lastReap > reapIntervalMs) {
      lastReap = Date.now();
      try {
        const reaped = await reapOldEvents(retentionMs);
        if (reaped > 0) {
          opts.log.info({ reaped }, "outbox reaper removed old rows");
        }
      } catch (err) {
        opts.log.warn({ err }, "outbox reap failed");
      }
    }
  };

  const handle = setInterval(() => void tick(), interval);
  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
