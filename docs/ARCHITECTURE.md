# InsightView Architecture

## Why this document exists

InsightView started life as a Playwright-based GitHub Action that
emitted Web Vitals to Prometheus Pushgateway and uploaded trace
artifacts to S3. That design was a solid proof-of-concept but it had
four structural gaps against production-grade monitoring platforms:

1. No geographic distribution or self-managed scheduling.
2. No alerting engine.
3. No self-monitoring (GitHub Actions cron is best-effort — jobs can
   be silently dropped).
4. No real-user monitoring (RUM).

This document describes the MVP vertical slice of the platform
evolution — a self-contained, end-to-end system that addresses every
critical gap in a single docker-compose stack while preserving the
Playwright+TypeScript developer experience and full backwards
compatibility with the original GitHub Action.

## High-level design

```
┌───────────────────────────── user layer ─────────────────────────────┐
│ React dashboard │ REST API │ GitHub Action │ monitors-as-code (YAML) │
└───────┬──────────────┬─────────────┬──────────────────────────────────┘
        │              │             │
┌───────▼──────────────▼─────────────▼──────────────────────────────────┐
│                          control plane                               │
│ apps/api (Fastify)        - check CRUD, run trigger, monitors apply   │
│ apps/scheduler            - leader-elected cron reconciler + watchdog │
│ apps/alerting             - strategy evaluator + channel dispatcher   │
└───────┬──────────────────────────────────────────────────────────────┘
        │  publishes/subscribes via @insightview/event-bus
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   event bus (BullMQ-on-Redis for MVP)                │
│   topics: checks.scheduled | checks.started | checks.completed       │
│           alerts.triggered | alerts.resolved | rum.events.ingested   │
└───────┬──────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────────┐
│                            data plane                               │
│ apps/runner         - Playwright-based check executor                │
│ apps/rum-collector  - Fastify RUM beacon intake                      │
│ packages/rum-sdk    - tree-shakeable browser SDK (web-vitals, errors)│
└───────┬──────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────────┐
│                          storage layer                              │
│ PostgreSQL via Prisma  - checks, runs, results, alerts, RUM events   │
│ Redis                  - queues, leader-election lease               │
│ Prometheus Pushgateway - mirrored synthetic_monitoring_* metrics     │
│ MinIO (S3-compatible)  - screenshots & trace artifacts               │
└──────────────────────────────────────────────────────────────────────┘
```

## Patterns in play

The MVP applies a deliberately short list of design patterns where
they earn their keep.

- **Hexagonal / ports-and-adapters** at four seams:
  1. **Event bus** (`packages/event-bus`) — any message producer or
     consumer talks to the `EventBus` interface, not BullMQ directly.
     See ADR 0002.
  2. **Repositories** (`packages/db/src/repositories/*`) — every
     service reads/writes Postgres via tenant-scoped functions, not
     raw Prisma calls scattered in route handlers.
  3. **Notification channels** — alert dispatch goes through a
     strategy registry, so adding a new channel (PagerDuty, email)
     is one file.
  4. **Alert strategies** — threshold, consecutive-failures, and
     composite evaluators all implement the same `Strategy` interface
     so future ML / anomaly detection can slot in without touching
     the evaluator.

- **Strategy pattern**: `apps/alerting/src/strategies/index.ts`
  registers impl per `AlertStrategy` enum value. Composite strategies
  delegate to other registered strategies, proving the interface
  supports composition.

- **Factory pattern**: `apps/alerting/src/channels/index.ts` and
  `packages/event-bus/src/factory.ts` hide implementation choice
  behind a simple `xxxFor(name)` lookup.

- **Idempotent consumers**: `apps/runner/src/main.ts` claims runs via
  `markRunStarted` which only succeeds on `QUEUED -> RUNNING`
  transitions. Duplicate job deliveries are naturally dropped.

- **Leader election**: `apps/scheduler/src/leaderElection.ts` uses
  Redis `SET NX PX` to elect exactly one active scheduler across the
  cluster. Lease is 30s with 10s renewal.

- **Dead-man's-switch watchdog**: The leader upserts a
  `WatchdogHeartbeat` row every 15s. `/healthz` on the API reports
  stale if the heartbeat is older than 3× the interval. This is the
  primitive that replaces GitHub Actions cron's silent-drop failure
  mode.

- **Event envelope versioning**: Every message carries
  `{ id, type, version, occurredAt, tenantId, traceId }`. Version is
  baked in on day one so future consumers can reject or upgrade
  old-version messages without breaking in-flight queues.

## Service breakdown (low-level)

### apps/api (Fastify, port 4000)

- Routes: `/v1/checks`, `/v1/runs`, `/v1/alert-rules`, `/v1/incidents`,
  `/v1/channels`, `/v1/rum/*`, `/v1/monitors/apply`,
  `/v1/monitors/validate`.
- `/healthz` checks DB reachability and watchdog staleness.
- `/metrics` exposes Prometheus metrics for the Prometheus service
  to scrape.
- Tenant resolution is stubbed via `apps/api/src/plugins/tenant.ts` —
  single point of change for future JWT-based multi-tenancy.

### apps/scheduler (Fastify + background loops, port 4100)

- `leaderElection.ts` — one active scheduler at a time.
- `scheduleLoop.ts` — every 15s, the leader queries enabled checks
  from Postgres and reconciles BullMQ repeatable jobs to match.
- `watchdog.ts` — heartbeats `WatchdogHeartbeat` table.
- `timeoutReaper.ts` — closes runs stuck in RUNNING past their safety
  window (handles crashed runners).

### apps/runner (Fastify health + BullMQ worker, port 4200)

- Subscribes to `checks.scheduled`.
- `executeRun.ts` launches a headless Chromium via the `playwright`
  package, collects Web Vitals (via the same injected `web-vitals`
  script the legacy code used), runs assertions, captures a screenshot,
  and publishes `checks.started` then `checks.completed`.
- Reuses the existing `src/exporters` patterns — a Pushgateway mirror
  and an S3 artifact uploader preserve the legacy observability
  surface so existing dashboards keep working.
- `src/legacy/*` contains the original Playwright fixture code
  (unchanged) so `command: legacy-run` still works for v1.x users.

### apps/alerting (Fastify health + BullMQ worker, port 4300)

- Subscribes to `checks.completed`.
- Evaluates each completion against every enabled `AlertRule` that
  matches the check.
- Strategies:
  - `ThresholdStrategy` — compares a single metric (duration or web
    vital) against an operator/threshold expression.
  - `ConsecutiveFailuresStrategy` — counts the non-PASSED streak
    ending at the latest run; fires if it meets the threshold.
  - `CompositeStrategy` — boolean AND/OR over sub-strategies.
- Channels: `StdoutChannel`, `SlackChannel`, `WebhookChannel`.
- Incidents are deduped by `(ruleId, checkId, severity)`.

### apps/rum-collector (Fastify, port 4400)

- Rate-limited intake endpoint at `POST /v1/events`.
- Validates via the Zod schema exported from
  `@insightview/rum-sdk/schema` — SDK and collector share the same
  type.
- Upserts `RumSession`, inserts `RumEvent` rows; all tenant-scoped.

### packages/rum-sdk (browser)

- IIFE bundle produced by esbuild — loaded by the test-site via a
  `<script>` tag.
- Auto-instruments Web Vitals (`onCLS`, `onFCP`, `onINP`, `onLCP`,
  `onTTFB`), JS errors, and navigation timing.
- Batches 20 events or 5 seconds of events.
- Flushes on `visibilitychange`/`pagehide` via `navigator.sendBeacon`.
- Session stitching via `sessionStorage` UUID.

### apps/dashboard (Vite + React, port 5173)

- Four pages: Checks, Runs, Alerts, RUM.
- Talks to the API via a thin fetch wrapper (`src/api/client.ts`);
  no TanStack Query because the pages are read-mostly and the extra
  dependency isn't earning its keep at MVP scale.

### apps/action-dispatcher (CLI)

- `insightview run|deploy|validate|status|legacy-run` — the command
  pattern behind the composite `action.yml`.
- Uses the same fetch wrapper the dashboard uses.

## Domain model (see packages/db/prisma/schema.prisma)

| Entity              | Purpose                                                       |
|---------------------|---------------------------------------------------------------|
| Check               | Monitor definition (name, schedule, target, assertions)       |
| CheckRun            | One execution attempt (QUEUED → RUNNING → terminal)           |
| CheckResult         | Per-step result snapshot (metrics, duration, status)          |
| AlertRule           | Strategy + expression mapping check results to incidents     |
| AlertIncident       | Fired alert, lifecycled by the evaluator (FIRING → RESOLVED)  |
| NotificationChannel | Destination for incidents (Slack, webhook, stdout)            |
| RumSession          | Browser session upserted on first event                       |
| RumEvent            | Individual RUM signal (web vital, error, navigation, custom)  |
| WatchdogHeartbeat   | Leader lease + liveness for dead-man's-switch                 |
| MonitorDeployment   | Audit trail for monitors-as-code pushes                       |

Every table carries `tenantId String @default("default")` with an
index so that future multi-tenancy is an API layer change, not a
schema migration.

## Sequence: synthetic run

1. Scheduler leader reconciles `Check { enabled: true }` into BullMQ
   repeatable jobs via `RepeatingJobScheduler.upsertSchedule`.
2. BullMQ emits a `CheckScheduled` envelope on `checks.scheduled`.
3. Runner worker consumes the envelope, allocates a `CheckRun(QUEUED)`
   with a fresh `runId`, then atomically transitions to `RUNNING` via
   `markRunStarted`. Duplicate deliveries fail that transition and
   are dropped.
4. Runner launches Chromium, navigates, collects Web Vitals and
   perf timings, runs assertions, captures a screenshot.
5. Runner writes a `CheckResult` row, pushes metrics to Pushgateway,
   uploads the screenshot to MinIO, then transitions the run to
   `PASSED | FAILED | ERROR | TIMEOUT` and publishes `CheckCompleted`.
6. Alerting service consumes `CheckCompleted`, evaluates every
   matching rule via the strategy registry, opens incidents, and
   dispatches notifications through the channel registry.

## Sequence: RUM event

1. Browser page loads `insightview-rum.iife.js`.
2. The SDK runs `init(...)` which (a) reads/creates a sessionStorage
   UUID, (b) installs auto-instruments, (c) starts the batching
   buffer.
3. Auto-instruments push events into the buffer. Buffer flushes on
   the earlier of 20 events, 5s elapsed, or page visibility hidden.
4. Transport calls `navigator.sendBeacon` with a JSON batch to
   `rum-collector:4400/v1/events` (with a `fetch(keepalive)` fallback).
5. The collector validates via the shared Zod schema, upserts the
   `RumSession` and inserts `RumEvent` rows.
6. Dashboard queries surface the events via `/v1/rum/events` and
   `/v1/rum/summary`.

## Where the gaps are still open (and what will close them)

The ROADMAP lists every deferred item, but the three biggest ones are:

- **Kafka** replaces BullMQ once multi-region deployment lands. The
  `@insightview/event-bus` interface is already the one-file swap
  point (see ADR 0002).
- **ClickHouse + VictoriaMetrics** replace Postgres + Pushgateway
  for metrics once cardinality or retention outgrows Postgres. The
  `@insightview/db` repository pattern isolates every caller, so
  swapping the metrics read path is a repository implementation
  change. See ADR 0003.
- **Geographic distribution** is a compose topology change — today
  every service runs in one compose network; Phase 2 splits the
  runner into a separate Docker image shipped to N regions via
  Kubernetes, consuming from region-sharded Kafka partitions.

See `docs/ROADMAP.md` for the phased plan and `docs/GAP_ANALYSIS.md`
for the severity matrix.
