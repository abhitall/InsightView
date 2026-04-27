# ADR 0010 — Kafka event bus + transactional outbox

**Status**: Accepted
**Date**: Iteration 4

## Context

ADR 0002 shipped the platform's EventBus interface with a
BullMQ-backed MVP implementation and explicitly promised that
the Kafka swap would be "a one-package change". This iteration
delivers that promise.

The two drivers:

1. Multi-region deployment (Phase 2 roadmap). BullMQ's Redis
   backend is a single-node failure domain — there's no sensible
   way to run the runner fleet in three regions against one
   Redis. Kafka's partitioned log model is the canonical fit.

2. Replay capability. Kafka's retention-based log lets us re-run
   any consumer against a past window (e.g. "replay the last 24
   hours of alerts because the evaluator had a bug"). BullMQ's
   queue is delete-on-consume and has no equivalent.

Plus an operational driver that only showed up after ADR 0002:
as the platform's test surface grew, the non-idempotent BullMQ
duplicate-delivery semantics started causing flaky e2e assertions
unless every consumer manually checked `CheckRun.status` before
claiming work. Kafka's per-key ordering + the transactional
outbox pattern give us stronger guarantees at the bus layer.

## Decision

### Kafka event bus

Add `KafkaEventBus` in `packages/event-bus/src/kafka/` alongside
the existing `BullMqEventBus`. The factory (`createEventBus()`)
selects between them via `BUS_BACKEND` env var or auto-detects
`KAFKA_BROKERS`.

Implementation notes informed by the research (see References):

- **kafkajs** is the transport. It's the only production-grade
  TypeScript Kafka client.
- **Producer idempotence is NOT relied upon**. kafkajs marks
  `idempotent: true` as experimental, and the research explicitly
  warns against depending on it for production. Consumers
  continue to be idempotent at the application layer — the
  runner's `markRunStarted(QUEUED → RUNNING)` transition was
  already doing this, and it's now the single safety net.
- **Per-key ordering** via the `dedupeKey` publish option, which
  is passed as the Kafka message key. Messages sharing a key
  always land in the same partition, so same-resource order is
  guaranteed.
- **Topics are auto-created** on first publish with
  `numPartitions: 12` — enough headroom for horizontal consumer
  scaling without repartitioning later.
- **Consumer groups** map to the `subscribe()` `group` option.
  This is why the interface had that field in ADR 0002 even when
  BullMQ ignored it.
- **Delays are NOT implemented**. Kafka has no built-in delayed
  delivery; the scheduler owns all cron + delay via the
  `KafkaScheduler` (node-cron in-process) so the bus itself
  stays scheduling-free.

### Transactional outbox

Add a `DomainEvent` table in Prisma. Writers call
`appendDomainEvent(ctx, input, tx)` inside their existing
transaction to persist the event in the same unit-of-work as the
business row. A new `OutboxPublisher` loop in the scheduler
service reads unpublished rows and ships them to Kafka.

Design choices informed by the research:

- **Mark-and-don't-delete**: rows flip `publishedAt` rather than
  getting DELETE'd. Postgres MVCC bloats under high-frequency
  deletes, so a periodic reaper (default 7-day retention) cleans
  up in batches.
- **Leader-only**: only the active scheduler leader runs the
  publisher, so there's no duplicate-publisher concurrency issue.
- **At-least-once delivery**: the publisher may crash between
  publish and mark. On restart it re-publishes. Consumers are
  already idempotent so duplicates are a drop-on-reap, not a
  correctness bug.
- **Outbox is only wired when Kafka is selected**. BullMQ's
  single-hop semantics make the outbox unnecessary for that
  backend — enabling it unconditionally would double the DB
  write amplification for zero safety gain.

### Kafka in docker-compose

A new `kafka` service runs Bitnami's KRaft-mode image (no
ZooKeeper). It's behind a `kafka` compose profile so the default
`docker compose up` still boots fast — set `--profile kafka` to
include it.

## Consequences

- The `BUS_BACKEND=kafka` switch is a true drop-in. Every
  consumer and producer in the platform was already written
  against the EventBus interface per ADR 0002, so no application
  code changed. Switching the env var triggers the factory path
  and the same code keeps working.
- `KafkaScheduler` replaces `BullMqScheduler` when Kafka is
  selected. It uses `node-cron` in-process, which means the
  leader-elected scheduler is the source of truth for cron
  expressions. A leader failover re-reconciles schedules from
  Postgres within 15s (the schedule loop interval) so the
  failure window is bounded.
- The outbox runs at up to 1.5s publish latency (the
  `intervalMs` default on the publisher). High-priority paths
  like "user triggered a run from the UI" still publish
  directly via the bus for < 50ms latency — the outbox is for
  "events that must survive a crash".
- Developers who don't need Kafka locally pay zero cost: the
  BullMQ default path is unchanged.

## Consequences — operational

- Monitoring Kafka itself is the caller's problem. The Helm
  chart does NOT ship a Kafka operator — point at a managed
  service (MSK, Confluent Cloud, Redpanda Cloud) or a separate
  Kubernetes-native installer.
- The `KafkaEventBus.healthcheck()` hits the admin client so
  the API `/healthz` route naturally reports the Kafka state.
- For replay (the big Kafka-only win), consumers can set
  `fromBeginning: true` in the subscribe options and an offset
  reset manually via kafka-consumer-groups. A CLI wrapper is
  Phase 5 work.

## Alternatives considered

- **Redpanda** (Kafka-compatible, single C++ binary). Tempting
  for smaller deployments — it would drop straight into the
  chart. Not selected because teams with Kafka already benefit
  from sharing their existing cluster; teams without can still
  use Redpanda via the same brokers env var (the wire protocol
  is identical).
- **NATS JetStream**. Nicer operational story, but a different
  wire format means switching from BullMQ → NATS would be a
  bigger refactor than the one-package promise, and NATS has
  weaker replay semantics than Kafka.
- **Debezium CDC** on the outbox table instead of the custom
  publisher. Considered but adds Kafka Connect as an operational
  dependency. The custom publisher is ~80 lines and fits in the
  scheduler process; it's worth the simplicity trade.

## References

- [kafkajs idempotent producer issue #200](https://github.com/tulios/kafkajs/issues/200)
- [Kafka idempotent producer best practices](https://www.lydtechconsulting.com/blog/kafka-idempotent-producer)
- [Transactional outbox pattern — Microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)
- [Conduktor — Transactional Outbox: Database-Kafka Consistency](https://www.conduktor.io/blog/transactional-outbox-pattern-database-kafka)
- [PostgreSQL + Outbox Pattern Revamped](https://dev.to/msdousti/postgresql-outbox-pattern-revamped-part-1-3lai)
