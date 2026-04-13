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

## Two modes, one codebase

InsightView ships two execution modes that share the same monitors-
as-code YAML, assertion vocabulary, error classification, and
exporter set:

1. **Platform mode** — the docker-compose stack. Distributed
   scheduler, alerting engine, RUM collector, React dashboard,
   Postgres/Redis/MinIO/Prometheus. Best for teams that want central
   aggregation across many monitors, tenants, and regions.

2. **Actions-native mode** — a single GitHub Actions workflow that
   runs Playwright monitors end-to-end inside the runner, with no
   separate infrastructure. Best for teams that want the lowest
   operational overhead while still getting production-grade
   reliability. See [ADR 0007](adr/0007-actions-native-synthetic.md)
   for the detailed design and reliability fixes.

Both modes read the same `monitors/*.yaml` files and emit the same
`ResultEnvelope` shape, so you can start in Actions-native mode and
layer the platform on top later without rewriting anything.

**Crucially, both modes are implemented by the same code**: the
platform runner (`apps/runner`) is a thin wrapper around
`@insightview/synthetic-kit` — the same library the Actions-native
mode uses. See [ADR 0008](adr/0008-platform-runner-unification.md)
for the rationale. One source of truth means one place to fix bugs
and add features.

## High-level design (platform mode)

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

## Actions-native mode

```
┌─ GitHub Actions runner (ubuntu-latest, Playwright container) ────┐
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ action.yml  command: native-run                            │  │
│  │   ↓                                                         │  │
│  │ apps/action-dispatcher  nativeRun.ts                        │  │
│  │   ↓                                                         │  │
│  │ packages/synthetic-kit  runCheck(spec)                      │  │
│  │   ├─ bundled web-vitals IIFE (no CDN fetch)                 │  │
│  │   ├─ bypassCSP: true, reportAllChanges: true                │  │
│  │   ├─ forced visibilitychange → hidden                       │  │
│  │   ├─ Navigation Timing fallback (always collected)          │  │
│  │   ├─ CDP Performance.getMetrics                             │  │
│  │   ├─ Auth: none / storage-state / form-login / TOTP / OAuth │  │
│  │   ├─ Network: direct / proxy / mtls / tailscale             │  │
│  │   └─ 4-category error classification                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                         │                                        │
│          Exporters (fire-and-forget, partial-safe)               │
│   ┌─────────┬──────────┬──────────┬──────────┬──────────┐        │
│   ▼         ▼          ▼          ▼          ▼          ▼        │
│ stdout  pushgateway   s3      github-artifact  hc-ping platform  │
└──────────────────────────────────────────────────────────────────┘

Triggering (workflow-level reliability):
  - schedule: cron (best-effort)                                    ┐
  - workflow_dispatch (manual / REST API)                           ├── dual
  - repository_dispatch (external scheduler: EventBridge, etc.)     ┘
  - dead-man's-switch heartbeat → healthchecks.io on success/fail
```

### Reliability fixes built into the synthetic-kit

The following reliability fixes were uncovered through research and
are all implemented in `packages/synthetic-kit`:

| Failure mode | Fix |
|---|---|
| LCP/CLS never resolve in headless Playwright | `reportAllChanges: true` + forced `visibilitychange → hidden` dispatch before collection |
| CSP blocks unpkg web-vitals CDN | Bundle web-vitals IIFE content from `node_modules` at process start; inject via `addInitScript({ content })` |
| Strict `script-src` blocks `addInitScript` | `bypassCSP: true` on every BrowserContext |
| INP needs a real interaction | Simulate `page.click("body", { force: true })` before finalizing |
| Consent banner becomes the LCP target | `preCookies` array lets the spec pre-set consent before navigation |
| Playwright browser install fails in CI | Pin `container: mcr.microsoft.com/playwright:v1.51.0-noble` in the workflow |
| GitHub Actions cron is dropped silently | Triple-trigger (schedule + workflow_dispatch + repository_dispatch) + dead-man's-switch heartbeat |
| Target down vs. our CI broken ambiguity | `classifyError` returns one of `TARGET_DOWN`, `TARGET_ERROR`, `INFRA_FAILURE`, `PARTIAL` |
| Total collection failure loses all data | Always emit Navigation Timing fallback so TTFB/FCP/DNS/TLS/DCL/load survive even if web-vitals fails |
| Auth requires credentials in code | Strategy pattern: `none`, `storage-state`, `form-login`, `totp`, `oauth-client-credentials`, `vault-oidc` (with dual-credential rotation) |
| Private network access needs a VPN | `tailscale/github-action@v4` installs the tunnel at workflow level; synthetic-kit sees a normal route |
| mTLS for client-certificate endpoints | `mtls` network profile loads cert+key from base64 env vars |
| CDN cache hit/miss is hidden in origin TTFB | `classifyCacheHeaders` detects `cf-cache-status`/`x-cache`/`x-vercel-cache` and emits `cdnCache: {status, source, age}` per step |
| Flaky transient failures page on-call | `retries` spec field triggers retry-with-flaky marker so dashboards surface flakiness without firing alerts |
| Browser memory leaks on long runs | `runCheckBatch` recycles the browser every N runs (default 20) |
| CI can't exercise slow-network behavior | `networkEmulation: "fast-3g"` / `"slow-3g"` / `"4g"` / `"offline"` applies Chrome DevTools throttling |
| Single-region monitoring misses geography | `infra/k8s/actions-runner-controller/` manifests deploy self-hosted runners across multiple regions |
| Real user LCP diverges from synthetic baseline | Shared metric schema in Grafana dashboards (`infra/grafana/dashboards/rum.json`) overlays synthetic + RUM p75 directly |
| Minified RUM error stacks are unactionable | `POST /v1/source-maps` + `POST /v1/source-maps/resolve` deobfuscates via the `source-map` npm package |
| Users abandon before error reproduces | rrweb-backed session replay opt-in at configurable sample rate, stored in `RumReplayChunk` |
| High RUM traffic hits origin collector | Cloudflare Worker edge collector at `infra/cloudflare-worker/` proxies from 330+ PoPs |
| Runner duplication between modes | Platform runner is now a thin wrapper around `@insightview/synthetic-kit` — ADR 0008 |
