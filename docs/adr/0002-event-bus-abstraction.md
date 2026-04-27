# ADR 0002 — Event bus abstraction (BullMQ today, Kafka tomorrow)

**Status**: Accepted
**Date**: MVP vertical slice

## Context

The scheduler, runner, alerting, and rum-collector services need to
communicate asynchronously. BullMQ over Redis is the obvious MVP
choice (mature, TypeScript native, supports cron repeatables, runs
in any compose stack) but Phase 2 of the roadmap calls for Kafka
to support multi-region deployments and guaranteed replay.

If we exposed BullMQ's `Queue` and `Worker` types directly in service
code, the Kafka swap would require rewriting every producer and
consumer. We need an abstraction that lets the MVP ship fast without
painting Phase 2 into a corner.

## Decision

Define a narrow `EventBus` interface in `@insightview/event-bus` that
exposes exactly the primitives every service needs and nothing more.

```ts
interface EventBus {
  publish<T>(topic: string, msg: Envelope<T>, opts?: PublishOptions): Promise<void>;
  subscribe<T>(topic: string, handler: Handler<T>, opts?: SubscribeOptions): Promise<Subscription>;
  healthcheck(): Promise<{ ok: boolean; backend: string }>;
  close(): Promise<void>;
}

interface RepeatingJobScheduler {
  upsertSchedule(opts: { key, topic, cron, payload, tenantId }): Promise<void>;
  removeSchedule(key: string): Promise<void>;
  listSchedules(): Promise<Array<{ key, cron }>>;
  close(): Promise<void>;
}
```

The interface deliberately:

- Uses plain JSON envelopes (`{ id, type, version, occurredAt, tenantId, traceId, payload }`).
- Separates *event publication* from *cron scheduling*. Cron is its
  own interface (`RepeatingJobScheduler`) so the Kafka migration
  doesn't need to implement cron — we'll swap that impl for a
  node-cron-based producer.
- Requires consumers to be idempotent (documented in the type
  doc-comments). BullMQ dedupes by `jobId`, Kafka will not — so
  services already check `CheckRun.status` before claiming work.
- Only supports "at least once" delivery semantics. Services handle
  duplicates at the application layer.
- Has no direct reference to `Queue`, `Worker`, `Job`, or any other
  BullMQ type.

Today's implementation is `BullMqEventBus` + `BullMqScheduler` in
`packages/event-bus/src/bullmq/`. The factory
`createEventBus()` picks the implementation from `REDIS_URL` / future
`KAFKA_BROKERS` env vars.

## Consequences

- The MVP uses BullMQ and requires a Redis in compose. Acceptable.
- Phase 2 introduces `KafkaEventBus` as a sibling implementation.
  Production swaps via an env var and the rest of the codebase is
  untouched.
- Consumers cannot use BullMQ-only features (like cross-queue
  dependencies or per-job priority). We considered this a forcing
  function toward a clean message model and accepted the limitation.
- Observability is uniform: every adapter records a shared
  `insightview_event_bus_messages_total` counter, so Phase 2's
  switch is visible on the same dashboard.

## Alternatives considered

- **Expose BullMQ directly, refactor later**. Rejected — the
  refactor would touch every service and land during the most
  critical phase of the rollout.
- **Use Kafka from day one**. Rejected — too much infrastructure
  complexity for a single-host MVP. Developers would have to run a
  3-broker Kafka in compose just to test their changes.
- **NATS JetStream**. Considered but lacks BullMQ's cron repeatables
  and introduces another protocol the team doesn't know yet. Will
  re-evaluate at Kafka migration time.
