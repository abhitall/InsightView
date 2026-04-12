# ADR 0003 — Storage strategy

**Status**: Accepted
**Date**: MVP vertical slice

## Context

The platform persists three distinct kinds of data:

1. **Configuration**: checks, alert rules, notification channels,
   deployments. Low volume, frequently read, strong consistency
   required.
2. **Time-series check results**: synthetic run outputs, per-step
   Web Vitals. Medium volume, rarely updated, heavily queried for
   dashboards.
3. **High-cardinality RUM events**: per-pageview metric streams
   from real users. Potentially huge volume, write-heavy, ad-hoc
   analytical queries.

Industry standard at scale uses three different databases: a
relational store (Postgres) for config, a time-series store
(VictoriaMetrics or Mimir) for metrics, and a columnar store
(ClickHouse) for event analytics. That's the right target state —
but we don't need it on day one.

## Decision

For the MVP vertical slice, **use PostgreSQL via Prisma for all
three data types, plus Prometheus Pushgateway for a mirrored
metrics export path**.

Justification:

- The biggest-volume data (RUM events) is zero without real users,
  which we don't have on day one. Even at modest adoption the volume
  is well within a single Postgres box's ability to handle.
- Prisma gives us schema-first migrations, type safety end-to-end,
  and a single source of truth all services can import. Splitting
  across three datastores on day one would cost time the MVP can't
  afford.
- Keeping the Prometheus Pushgateway mirror preserves the v1
  dashboards that downstream users already built PromQL against.
  The runner double-writes to both Postgres and Pushgateway.
- The repository pattern (`packages/db/src/repositories/*`) isolates
  every caller from Prisma internals, so when we migrate `CheckResult`
  and `RumEvent` to ClickHouse in Phase 2 the change is contained
  to the two repository files and nothing else.

The Prisma schema is designed with the migration in mind:

- `tenantId String @default("default")` on every row enables
  row-level tenant isolation now and easy partitioning by tenant
  later.
- JSON columns for anything that isn't cardinality-safe
  (`webVitals`, `resourceStats`, `attributes`) so ClickHouse can
  import them as `Map(String, Float64)` later.
- Indexes on `(tenantId, siteId, type, receivedAt)` for RUM and
  `(tenantId, createdAt)` for results so current dashboard queries
  return in <100ms up to ~10M rows.

## Consequences

- One database to back up, one connection pool to configure, one
  set of Prisma types to keep in sync. MVP complexity is minimized.
- The runner double-writes metrics (Postgres + Pushgateway). Extra
  code but zero observability gap during the transition.
- Phase 2's ClickHouse migration is explicit work but well-contained:
  swap two repository files, optionally drop the Pushgateway mirror
  once VictoriaMetrics is wired in.
- Postgres JSON columns are the pragmatic choice; they can't be
  queried as well as typed columns but MVP dashboards group by the
  `name` field which is promoted to a typed column in `RumEvent`.

## Alternatives considered

- **ClickHouse from day one**. Rejected — the operational complexity
  (zk / keeper, replication, materialized views, tiered storage) is
  a full-time project on its own. Not MVP-appropriate.
- **VictoriaMetrics from day one**. Rejected — it's the right
  long-term fit for metrics, but the MVP's cardinality is low
  enough that Postgres handles it.
- **TimescaleDB (Postgres extension)**. Serious contender; it gives
  us time-series features without a new datastore. We may revisit
  this as a stepping stone between "plain Postgres" and "ClickHouse"
  if customer feedback points that direction.
