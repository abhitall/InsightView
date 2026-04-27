# InsightView Roadmap

## Context

The original InsightView GitHub Action was a strong proof-of-concept
for synthetic monitoring but sat four critical gaps shy of a
production platform. This roadmap plots the path from today's MVP
vertical slice through an 18-month buildout that closes every gap
without breaking the Playwright-first, code-first, zero-lock-in
philosophy that made v1 worth keeping.

Each phase below is scoped to preserve backwards compatibility with
the previous phase (the `legacy-run` GitHub Action command will keep
working through Phase 4 and beyond).

## Phase 0 — Where we are (after iterations 1–3)

The repository now delivers everything the original research plan
called out as Critical or High severity, plus the Actions-native
execution mode and the full RUM depth suite:

**Monorepo (17 workspaces, pnpm)**

- Shared libs: `@insightview/core`, `@insightview/db`,
  `@insightview/event-bus`, `@insightview/observability`,
  `@insightview/rum-sdk`, `@insightview/synthetic-kit`,
  `@insightview/rum-react`, `@insightview/rum-vue`.
- Services: `apps/api`, `apps/scheduler`, `apps/runner`,
  `apps/alerting`, `apps/rum-collector`, `apps/dashboard`,
  `apps/action-dispatcher`, `infra/e2e`.

**Synthetic monitoring (both modes)**

- Distributed scheduler with leader election, reconcile-from-DB
  cron loop, dead-man's-switch watchdog, timeout reaper.
- Containerized Playwright runner (platform mode) — a thin wrapper
  around `@insightview/synthetic-kit` so there's exactly one source
  of truth (ADR 0008).
- Actions-native mode via `command: native-run` on the composite
  GitHub Action, with the same YAML monitors and the same
  `ResultEnvelope` output.
- `synthetic-kit` ships: bundled web-vitals IIFE, `bypassCSP`,
  `reportAllChanges`, forced `visibilitychange`, Navigation
  Timing fallback, CDP metrics, CDN cache hit/miss detection,
  4-category error classification, retry-with-flaky tracking,
  `runCheckBatch` (browser recycling), CDP network throttling,
  auth strategies (none / storage-state / form-login / totp /
  oauth-client-credentials / vault-oidc with dual-credential
  rotation), network profiles (direct / proxy / mtls / tailscale /
  wireguard), and 6 exporters (stdout / pushgateway / s3 /
  github-artifact / healthchecks / platform).

**Alerting**

- Threshold, consecutive-failures, and composite strategies.
- Slack, generic webhook, stdout channels.
- Dedupe by `(ruleId, checkId, severity)`.
- **8 unit tests** cover every branch of the strategy engine.

**RUM**

- `@insightview/rum-sdk` IIFE + ESM. Auto web-vitals, errors,
  navigation, optional resources, optional session replay (rrweb).
- `apps/rum-collector` with Zod schema validation, session
  stitching, `POST /v1/events` + `POST /v1/replay`.
- Source map upload + server-side deobfuscation via the
  `source-map` package (`POST /v1/source-maps`,
  `POST /v1/source-maps/resolve`).
- Framework packages: `@insightview/rum-react`,
  `@insightview/rum-vue`.
- Cloudflare Worker edge collector (`infra/cloudflare-worker/`)
  proxies beacons from 330+ edge PoPs with cf-geo enrichment.

**GitHub Action dispatcher**

- 6 commands: `run`, `deploy`, `validate`, `status`,
  `native-run`, `legacy-run`.
- 5 workflows: `ci.yml` (typecheck + unit tests),
  `run-check.yml`, `deploy-monitors.yml`, `validate-monitors.yml`,
  `e2e.yml` (label-gated), `native-synthetic.yml` (triple-
  triggered: cron + workflow_dispatch + repository_dispatch),
  `legacy-synthetic-monitoring.yml`.

**Infrastructure**

- `infra/docker-compose.yml` stack: postgres, redis, minio,
  pushgateway, prometheus, api, scheduler, runner, alerting,
  rum-collector, dashboard, test-site.
- `infra/grafana/dashboards/` JSON dashboards for synthetic +
  unified synthetic/RUM overlay.
- `infra/k8s/actions-runner-controller/` ARC manifests for
  multi-region self-hosted runners.
- `infra/cloudflare-worker/` edge RUM collector.

**Tests**

- `vitest` suite with **33 unit tests** covering error
  classification, assertions, monitor YAML parser, alert
  strategies, and monitorsYaml parser.
- `infra/e2e/e2e.ts` docker-compose end-to-end test.
- CI runs typecheck + unit tests on every push.

**Docs**

- `ARCHITECTURE.md`, `ROADMAP.md`, `GAP_ANALYSIS.md`,
  `MONITORING_RECIPES.md`, and 9 ADRs
  (`docs/adr/0001..0009-*.md`).

## Phase 1 — Harden the foundation ✅ **DELIVERED**

- ✅ Unit test coverage at every service seam — **41 tests** across
  synthetic-kit errors/assertions/parser, alerting strategies
  (including anomaly + rum-metric), and monitorsYaml parser.
- ✅ Bearer token authentication via Fastify plugin
  (`apps/api/src/plugins/tenant.ts`), supporting both the static
  `API_TOKEN` env var (local dev) and issued `iv_*` tokens from
  the `ApiToken` table (production).
- ✅ RBAC skeleton: `role` column on `ApiToken` with three rungs
  (`read < write < admin`). Routes guard with
  `{ preHandler: requireRole("admin") }`.
- ✅ CI gate runs `pnpm typecheck` + `pnpm test:unit` on every push
  and PR (`.github/workflows/ci.yml`).
- ✅ Structured audit log: `AuditLog` table + `recordAudit` helper.
  Every token mint / revoke / monitor deploy emits a row.
  Queryable via `GET /v1/audit`.
- ✅ Observability: Pino for logs, prom-client for metrics,
  **OpenTelemetry** for traces. `initTracing(service)` wires
  OTLP/HTTP export when `OTEL_EXPORTER_OTLP_ENDPOINT` is set and
  falls back to in-process spans + propagation otherwise.
- ✅ Helm chart at `infra/helm/insightview/` for single-region
  Kubernetes deployment, with optional Kafka / OTel / auth secrets.

## Phase 2 — Core platform ✅ **DELIVERED (selective migrations)**

The user requested only two migrations: BullMQ → Kafka and the
new anomaly alerting strategy. ClickHouse and VictoriaMetrics
are explicitly deferred as operational decisions, not code gaps.

- ✅ **Kafka replaces BullMQ as the transport.** `KafkaEventBus`
  in `packages/event-bus/src/kafka/` alongside the BullMQ impl.
  Factory selects via `BUS_BACKEND=kafka` / `KAFKA_BROKERS`
  env vars. The `@insightview/event-bus` interface from ADR
  0002 meant zero application-code changes — ADR 0010 describes
  the full design.
- ✅ **Transactional outbox.** `DomainEvent` table +
  `OutboxPublisher` loop in the scheduler. Writers append events
  in the same tx as their business rows; the leader-elected
  publisher ships them to Kafka with at-least-once semantics.
- ✅ **KafkaScheduler**. `node-cron`-driven replacement for the
  BullMQ repeatable-job scheduler. Fires W3C-traceparent-
  propagated envelopes into Kafka.
- ✅ **Multi-region runners**: ARC manifests at
  `infra/k8s/actions-runner-controller/` deploy three regional
  scale sets (us-east, eu-west, ap-southeast). Platform runner
  is region-agnostic; Actions-native mode works from any region
  the ARC scale set lives in.
- ❌ ClickHouse — **not requested** (and the current Postgres
  path is not the bottleneck at MVP traffic).
- ❌ VictoriaMetrics — **not requested** (the existing Prometheus
  Pushgateway mirror satisfies the current dashboards).
- ✅ **Private locations**: runner Docker image ships with
  `infra/docker/Dockerfile.runner`, Helm chart parameterizes
  replica count + resource requests, ARC manifests parameterize
  the region label.
- ✅ **API tokens scoped + TTL**: `POST /v1/tokens` mints tokens
  with role, scopes, and `expiresInDays`. Revoke via
  `DELETE /v1/tokens/:id`.
- ✅ **Terraform HCL modules**: `infra/terraform/modules/{monitor,alert-rule,channel}`
  — Terraform users can declare monitors-as-code in HCL and the
  modules POST to `/v1/monitors/apply`. A Go-based provider is
  Phase 5 work.

## Phase 3 — RUM depth ✅ **DELIVERED**

- ✅ **User interaction tracking** in `@insightview/rum-sdk`:
  `installInteractionTracking` captures clicks (with a
  privacy-safe selector + truncated text) and monkey-patches
  `history.pushState` / `replaceState` / listens for `popstate`
  so SPA route changes emit NAVIGATION events.
- ✅ **Framework integrations**: `@insightview/rum-react`
  (`RumProvider`, `useRumClient`, `useTrackRoute`) and
  `@insightview/rum-vue` (`app.use(InsightViewRum, {...})` with
  `inject("rum")` and error handler hook).
- ✅ **Source map deobfuscation**: `POST /v1/source-maps` stores
  maps keyed by `(tenant, release, bundleUrl)`.
  `POST /v1/source-maps/resolve` takes a raw stack and returns
  the deobfuscated stack via `SourceMapConsumer`.
- ✅ **Unified dashboard view**: `infra/grafana/dashboards/rum.json`
  includes a "synthetic vs RUM LCP overlay" panel keyed by the
  same metric schema.
- ✅ **Geo-IP enrichment**: `apps/rum-collector/src/geo.ts` uses
  `geoip-lite` (bundled MaxMind GeoLite2 snapshot). Session
  country is populated on every intake and cached per session.
- ✅ **RUM-driven alert rules**: `RUM_METRIC` strategy fires on
  p50/p75/p95/mean aggregates over a rolling RUM window. The
  evaluator pre-computes aggregates before invoking the strategy
  so the strategy stays pure.

## Phase 4 — Intelligence + depth ✅ **DELIVERED**

- ✅ **Anomaly detection** (Layer 1 of the research plan's
  three-layer stack): `AnomalyDetectionStrategy` with rolling
  z-score, configurable window, direction (higher/lower/both),
  minimum samples, and zero-variance edge case. ADR 0011
  describes the full algorithm. Layers 2 (Isolation Forest) and
  3 (Prophet) plug into the same interface with no evaluator
  changes — Phase 5 work.
- ✅ **Session replay** via rrweb — delivered in Iteration 3,
  documented in ADR 0009.
- ✅ **OpenTelemetry trace correlation**: synthetic-kit calls
  `injectTraceHeaders` on the BrowserContext's extra HTTP
  headers so every outbound request (including navigation)
  carries a `traceparent`. OTLP export wired via
  `initTracing` in `packages/observability`. ADR 0012.
- ✅ **Public status pages**: `GET /v1/status.json` +
  `GET /v1/status/*` render unauthenticated platform status.
  Dependency-free HTML template.
- ✅ **PR deploy gates**: `action-dispatcher` `status` command
  now supports `--fail-on-degrade`, `--window N`, and
  `--min-success-ratio F` flags. Outputs `latest_status` and
  `success_ratio` for downstream workflow steps.
- ✅ **RBAC + audit logs** delivered as part of Phase 1 above.
  SOC 2 Type II certification itself is a business-process item,
  not a code gap.
- ✅ **Mobile RUM SDK**: `@insightview/rum-mobile` package —
  runtime-agnostic TypeScript that compiles for React Native
  and embeds as a module inside Swift/Kotlin hosts via a
  `NativeHost` hook interface. Same wire format as the browser
  SDK so the same rum-collector accepts mobile beacons.

## Migration paths

| Transition              | Single-file change                             |
|-------------------------|------------------------------------------------|
| BullMQ → Kafka          | `packages/event-bus/src/factory.ts`            |
| Postgres → ClickHouse   | `packages/db/src/repositories/results.ts` + `rum.ts` |
| Prometheus → VictoriaM. | `apps/runner/src/exporters/PrometheusPushgatewayExporter.ts` (change target URL) |
| stdout → PagerDuty      | Add `apps/alerting/src/channels/PagerDutyChannel.ts` + registry entry |
| New alert strategy      | Add a file to `apps/alerting/src/strategies/` + registry entry |

Every one of these transitions was shaped by the MVP's choice of
interface seams.
