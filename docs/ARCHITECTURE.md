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
┌──────────────────────────── USER LAYER ───────────────────────────────┐
│ React dashboard │ REST API │ GitHub Action (6 cmds) │ monitors-as-code│
│ Public status page │ Terraform HCL modules │ Grafana dashboards      │
└───────┬──────────────┬─────────────┬──────────────────────────────────┘
        │              │             │
┌───────▼──────────────▼─────────────▼──────────────────────────────────┐
│                          AUTH PLANE (ADR 0012)                       │
│ tenant plugin: static API_TOKEN | issued iv_* tokens | anonymous     │
│ requireRole("admin" | "write" | "read") route guards                 │
│ ApiToken (SHA-256 hashed, role + scopes + TTL + revokedAt)           │
│ AuditLog: every mutating request records (actor, action, resource)   │
└───────┬──────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────────┐
│                          CONTROL PLANE                              │
│ apps/api (Fastify)        - checks, runs, alerts, monitors/ingest   │
│                             + tokens + audit + source-maps          │
│                             + public status page + /metrics         │
│ apps/scheduler            - leader-elected cron reconciler          │
│                             + WatchdogHeartbeat (dead-man)          │
│                             + TimeoutReaper                         │
│                             + OutboxPublisher (Kafka mode only)     │
│ apps/alerting             - 5 strategies: threshold, consecutive,   │
│                             composite, anomaly z-score, rum-metric  │
└───────┬──────────────────────────────────────────────────────────────┘
        │  publishes/subscribes via @insightview/event-bus (ADR 0002)
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│            EVENT BUS  (BullMQ default, Kafka via env var)            │
│   Factory picks backend from BUS_BACKEND / KAFKA_BROKERS             │
│   Topics:                                                            │
│     checks.scheduled │ checks.started │ checks.completed             │
│     alerts.triggered │ alerts.resolved │ rum.events.ingested         │
│   Transactional outbox (ADR 0010): writers append DomainEvent rows   │
│   in their DB tx; the leader-only publisher ships them to Kafka      │
│   with at-least-once delivery. Consumers are idempotent at the      │
│   application layer (CheckRun.status claim, RumEvent id dedupe).    │
└───────┬──────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────────┐
│                           DATA PLANE                                │
│ apps/runner         - thin wrapper around @insightview/synthetic-kit │
│ synthetic-kit       - Playwright, Web Vitals (bundled IIFE),         │
│                       Nav Timing fallback, CDP metrics,              │
│                       CDN cache hit/miss, retry-with-flaky,          │
│                       browser recycling, CDP network emulation,      │
│                       6 auth strategies, 5 network profiles,         │
│                       6 exporters, OTel traceparent injection        │
│ apps/rum-collector  - Fastify RUM intake + replay + geoip-lite       │
│ packages/rum-sdk    - browser SDK (web/errors/nav/replay/interacts)  │
│ packages/rum-react  - <RumProvider> + useRumClient + useTrackRoute   │
│ packages/rum-vue    - Vue 3 plugin                                   │
│ packages/rum-mobile - React Native / Swift / Kotlin hosts            │
│ infra/cloudflare-worker - edge RUM collector (330+ PoPs, cf-geo)     │
└───────┬──────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────────┐
│                          STORAGE LAYER                              │
│ PostgreSQL via Prisma  - 15 tables:                                 │
│   Check, CheckRun, CheckResult,                                     │
│   AlertRule, AlertIncident, NotificationChannel,                    │
│   RumSession, RumEvent, RumReplayChunk, SourceMap,                  │
│   WatchdogHeartbeat, MonitorDeployment,                             │
│   DomainEvent (outbox), ApiToken, AuditLog                          │
│ Redis                  - queues (BullMQ), leader-election lease     │
│ Kafka (opt)            - event log with per-key ordering            │
│ Prometheus Pushgateway - synthetic_monitoring_* metrics             │
│ MinIO / S3             - screenshots, traces, replay chunks         │
├──────────────────────────────────────────────────────────────────────┤
│                      OBSERVABILITY LAYER (ADR 0012)                 │
│ pino (logs) │ prom-client (metrics) │ OpenTelemetry (traces)         │
│ Grafana dashboards (synthetic.json, rum.json with overlay panel)    │
│ /metrics │ /healthz │ /readyz │ /v1/status.json                     │
│ OTLP/HTTP exporter → Tempo / Jaeger / Grafana Cloud                 │
│ W3C traceparent propagation through event bus and synthetic runs   │
└──────────────────────────────────────────────────────────────────────┘
```

## Patterns in play

The platform applies a deliberately short list of design patterns
where they earn their keep.

- **Hexagonal / ports-and-adapters** at six seams:
  1. **Event bus** (`packages/event-bus`) — any message producer or
     consumer talks to the `EventBus` interface, not BullMQ OR Kafka
     directly. The factory selects between the two impls per
     `BUS_BACKEND` env. ADR 0002 defined the interface; ADR 0010
     delivered the Kafka swap without touching any service code.
  2. **Repositories** (`packages/db/src/repositories/*`) — every
     service reads/writes Postgres via tenant-scoped functions, not
     raw Prisma calls scattered in route handlers.
  3. **Notification channels** — alert dispatch goes through a
     strategy registry, so adding a new channel (PagerDuty, email)
     is one file.
  4. **Alert strategies** — all 5 strategies (threshold, consecutive,
     composite, anomaly z-score, rum-metric) implement the same
     `Strategy` interface. ADR 0011 shows how future ML strategies
     (Isolation Forest, Prophet) plug in without touching the
     evaluator.
  5. **Auth strategies** (`packages/synthetic-kit/src/auth/`) — 6
     interchangeable implementations sharing a single `AuthStrategy`
     interface.
  6. **Exporters** (`packages/synthetic-kit/src/exporters/`) — 6
     sinks behind one `Exporter` interface.

- **Strategy pattern**: `apps/alerting/src/strategies/index.ts`
  registers impls per `AlertStrategy` enum value. Composite
  strategies delegate to other registered strategies, proving
  the interface supports composition. See
  [ADR 0011](adr/0011-anomaly-detection-strategy.md).

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
  `onTTFB`), JS errors, navigation timing, **click + route-change
  interactions**, and **optional rrweb session replay**.
- Batches 20 events or 5 seconds of events.
- Flushes on `visibilitychange`/`pagehide` via `navigator.sendBeacon`.
- Session stitching via `sessionStorage` UUID.

### packages/rum-react, rum-vue, rum-mobile

- **`@insightview/rum-react`** — `<RumProvider>` + `useRumClient()`
  + `useTrackRoute()`. Module-level singleton so components outside
  the provider get a safe no-op client.
- **`@insightview/rum-vue`** — Vue 3 plugin with `app.use()`,
  `inject("rum")`, and an auto-hook into `config.errorHandler`.
- **`@insightview/rum-mobile`** — runtime-agnostic TypeScript SDK
  that compiles for React Native and embeds as a module inside
  Swift/Kotlin hosts via the `NativeHost` interface. Same wire
  format as the browser SDK so the same rum-collector accepts
  mobile beacons.

### apps/dashboard (Vite + React, port 5173)

- Four pages: Checks, Runs, Alerts, RUM.
- Plus the **public status page** at `/v1/status/*` (rendered
  server-side by the API, dependency-free HTML).
- Talks to the API via a thin fetch wrapper (`src/api/client.ts`);
  no TanStack Query because the pages are read-mostly and the extra
  dependency isn't earning its keep at MVP scale.

### apps/action-dispatcher (CLI, 6 commands)

- `insightview run|deploy|validate|status|native-run|legacy-run`.
- `status` supports `--fail-on-degrade`, `--window N`,
  `--min-success-ratio F` for PR deploy gates. Writes
  `latest_status` and `success_ratio` as GitHub Action step outputs.
- `native-run` executes monitors directly via
  `@insightview/synthetic-kit` without any platform API.

## Domain model (see packages/db/prisma/schema.prisma)

| Entity              | Purpose                                                       |
|---------------------|---------------------------------------------------------------|
| Check               | Monitor definition (name, schedule, target, assertions)       |
| CheckRun            | One execution attempt (QUEUED → RUNNING → terminal)           |
| CheckResult         | Per-step result snapshot (metrics, duration, status)          |
| AlertRule           | Strategy + expression mapping check results to incidents     |
| AlertIncident       | Fired alert, lifecycled by the evaluator (FIRING → RESOLVED)  |
| NotificationChannel | Destination for incidents (Slack, webhook, stdout)            |
| RumSession          | Browser session upserted on first event (+ geo country)       |
| RumEvent            | Individual RUM signal (web vital, error, navigation, custom)  |
| RumReplayChunk      | Sequenced rrweb event batches for session replay              |
| SourceMap           | Uploaded source maps for stack deobfuscation                  |
| WatchdogHeartbeat   | Leader lease + liveness for dead-man's-switch                 |
| MonitorDeployment   | Audit trail for monitors-as-code pushes                       |
| DomainEvent         | Transactional outbox (Kafka publisher reads unpublished rows) |
| ApiToken            | Bearer tokens (SHA-256 hashed + role + scopes + TTL)          |
| AuditLog            | Generic audit log for every mutating request                  |

Every table carries `tenantId String @default("default")` with an
index so that future multi-tenancy is an API layer change, not a
schema migration.

## Sequence: synthetic run

1. Scheduler leader reconciles `Check { enabled: true }` into the
   bus scheduler via `RepeatingJobScheduler.upsertSchedule`.
   BullMQ mode uses repeatable jobs; Kafka mode uses in-process
   `node-cron` in `KafkaScheduler`.
2. On each cron fire the scheduler emits a `CheckScheduled`
   envelope on `checks.scheduled`.
3. Runner worker consumes the envelope, allocates a
   `CheckRun(QUEUED)` with a fresh `runId`, then atomically
   transitions to `RUNNING` via `markRunStarted`. Duplicate
   deliveries fail that transition and are dropped (this is the
   application-layer idempotency that makes at-least-once
   delivery safe under either backend).
4. Runner delegates to `@insightview/synthetic-kit runCheck`
   which launches Chromium, sets `bypassCSP`, installs the
   web-vitals IIFE, runs the auth strategy, configures the
   network profile, **injects OpenTelemetry traceparent headers
   onto the BrowserContext** (via `context.setExtraHTTPHeaders`),
   navigates, forces `visibilitychange → hidden`, collects
   metrics, classifies the CDN cache, runs assertions, captures
   a screenshot, retries transient failures with `flaky: true`.
5. Runner writes one `CheckResult` row per step, pushes metrics
   to Pushgateway, uploads artifacts to MinIO, then transitions
   the run to `PASSED | FAILED | ERROR | TIMEOUT` and publishes
   `CheckCompleted`. Downstream services (alerting, dashboard)
   read from the same distributed trace because the traceparent
   propagated through the event bus envelope headers.
6. Alerting service consumes `CheckCompleted`, loads enabled
   rules for the check, **pre-populates historical samples and
   RUM aggregates when an ANOMALY_DETECTION or RUM_METRIC rule
   is present**, evaluates each rule via the strategy registry,
   opens incidents (dedupe by `(ruleId, checkId, severity)`),
   and dispatches notifications through the channel registry.

## Sequence: Kafka + transactional outbox (ADR 0010)

When `BUS_BACKEND=kafka`:

1. A writer (API route, scheduler loop, etc.) calls
   `appendDomainEvent(ctx, input, tx)` inside its existing Prisma
   transaction. The row lands in `DomainEvent` with
   `publishedAt = NULL` in the same unit of work as the business
   mutation. Either both commit or both roll back — no dual-write
   consistency problem.
2. The `OutboxPublisher` loop in the leader-elected scheduler
   polls `listUnpublishedEvents(batchSize)` every 1.5s.
3. For each row it calls `bus.publish(topic, envelope, { dedupeKey })`
   on the Kafka bus. The dedupe key becomes the Kafka message key
   so same-resource messages always land in the same partition
   (per-key ordering guarantee).
4. Successful publishes are batch-flipped to `publishedAt = NOW()`
   via `markPublished(ids)`. Unmarked rows retry on the next tick.
5. A periodic reaper (`reapOldEvents`, default 15-min interval,
   7-day retention) deletes rows whose `publishedAt` is older than
   the retention window. The mark-and-reap pattern avoids Postgres
   MVCC bloat that delete-on-publish would cause.
6. Consumers (runner, alerting, dashboard) receive at-least-once
   delivery. Application-layer idempotency (CheckRun.status claim,
   RumEvent id dedupe) makes duplicates safe.

## Sequence: anomaly detection (ADR 0011)

1. `CheckCompleted` arrives at the alerting service for check `C`.
2. `evaluateCompletion` loads enabled rules for `C`. One is
   `ANOMALY_DETECTION` with `expression.metric = "LCP"`.
3. The evaluator detects the anomaly requirement (`needsAnomaly`
   flag) and pre-populates `historicalValues` by walking the last
   20 `CheckRun` rows, joining to their `CheckResult` children,
   and harvesting each web-vital measurement plus a synthetic
   `duration` bucket.
4. `AnomalyDetectionStrategy.evaluate` reads
   `historicalValues.LCP` (no DB access), computes the rolling
   mean + Bessel-corrected stddev, and compares the current
   observation's z-score to the configured threshold in the
   configured direction.
5. If `|z| >= threshold`, `Decision.shouldFire = true` with a
   reason like `"LCP=4500 z=4.23 (mean=1200 σ=780, threshold=±3)"`.
   The evaluator opens an `AlertIncident` and dispatches via the
   channel registry.
6. On the next PASS within bounds the same evaluator pass returns
   `shouldResolve = true`, flipping the incident to `RESOLVED`.

## Sequence: OpenTelemetry trace correlation

1. The synthetic-kit calls `injectTraceHeaders({})` from
   `@insightview/observability`. If OTel is initialized and a
   span context is active, it returns
   `{ traceparent: "00-...-01", tracestate: "..." }`.
2. `context.setExtraHTTPHeaders(traceHeaders)` applies these to
   every outgoing request the BrowserContext makes.
3. Chromium navigates to the target URL with `traceparent` in
   the request headers. The target's OTel-instrumented backend
   continues the same trace — the synthetic run is the root span
   and backend RPCs appear as children.
4. If `OTEL_EXPORTER_OTLP_ENDPOINT` is set, every service's spans
   batch-export to the OTLP collector. If unset, spans are still
   created and propagated in-process but dropped on the exporter
   boundary — no runtime overhead.
5. An on-call engineer debugging a synthetic failure can click
   through from the `ResultEnvelope.githubContext.runId` → trace
   id → Tempo/Jaeger → the exact backend span that was slow.

## Sequence: RUM event

1. Browser page loads `insightview-rum.iife.js`.
2. The SDK runs `init(...)` which (a) reads/creates a sessionStorage
   UUID, (b) installs auto-instruments including click + route-
   change interactions, (c) starts the batching buffer. Replay is
   an opt-in instrument that lazy-imports rrweb.
3. Auto-instruments push events into the buffer. Buffer flushes on
   the earlier of 20 events, 5s elapsed, or page visibility hidden.
4. Transport calls `navigator.sendBeacon` with a JSON batch to
   either the origin collector or the **Cloudflare Worker edge**
   (`infra/cloudflare-worker`), which enriches with cf-geo and
   forwards to the origin.
5. The origin collector validates via the shared Zod schema,
   **resolves country/region/city via bundled MaxMind GeoLite2**,
   upserts the `RumSession`, and inserts `RumEvent` rows with
   `attributes.geo` stamped on each event.
6. For session replay, separate rrweb chunks POST to
   `/v1/replay` and land in `RumReplayChunk` keyed by
   `(sessionId, sequence)`.
7. Dashboard queries surface the events via `/v1/rum/events`,
   `/v1/rum/summary`, and the Grafana dashboard's
   synthetic-vs-RUM overlay panel.

## Sequence: auth + audit log (ADR 0012)

1. Request arrives with `Authorization: Bearer <token>`.
2. The tenant plugin decides the three-mode branch:
   - Static `API_TOKEN` match → admin.
   - Token starts with `iv_` → `verifyToken` SHA-256 hashes it
     and queries the `ApiToken` table. Revoked or expired rows
     return 401. Valid rows populate `req.auth = { tokenId,
     role, scopes }`. The row's `lastUsedAt` is bumped async.
   - Neither → anonymous read-only (or 401 if a static token is
     configured and nothing matches).
3. Route handlers protected by `{ preHandler: requireRole("admin") }`
   check `req.auth.role` against the hierarchy
   `read < write < admin` and throw 403 if insufficient.
4. Mutating handlers call `recordAudit(ctx, input)` which inserts
   an `AuditLog` row with `(actor, action, resource, resourceId,
   metadata)`. The audit table is queryable via
   `GET /v1/audit?resource=...&resourceId=...`.

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
