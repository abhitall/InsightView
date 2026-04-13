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

## Phase 1 — Harden the foundation (months 1–3)

Goal: move from "MVP runs on one host" to "MVP is production-ready
on one region".

- Unit test coverage at every service seam (strategies, monitors-as-
  code parser, event-bus publish/subscribe round-trip).
- Integration tests for the API routes using supertest.
- Authentication: Bearer token on every non-health endpoint
  (already stubbed via `API_TOKEN` env var).
- RBAC skeleton: `role` on a tenant user table — maps to
  `api | write | admin`.
- CI: add `pnpm typecheck` and `pnpm test` gates to `.github/workflows/`.
- Structured audit log: every write (monitor apply, rule upsert,
  incident ack) lands in an append-only table.
- Observability: Pino → Loki / ELK, prom-client → Prometheus
  (already scraping the API).
- Dockerfile optimizations: pnpm fetch + install --offline pattern,
  distroless base, non-root user.
- Helm chart for a single-region Kubernetes deployment.

## Phase 2 — Core platform (months 4–7)

Goal: hit the two biggest gaps (multi-region + Kafka) and lock in
the production data model.

- Multi-region runners: separate Docker image, Kafka topic
  partitioning by region. The first runner on a new region registers
  itself via `POST /v1/locations`.
- Kafka (or Redpanda) replaces BullMQ as the transport. The
  `@insightview/event-bus` interface means no service-level code
  changes. Scheduler moves its cron handling out of BullMQ repeatables
  and into a dedicated node-cron producer that publishes to Kafka.
- Outbox pattern: scheduler writes `domain_events` rows inside the
  same tx as the `CheckRun` insert; a dedicated publisher ships them
  to Kafka with exactly-once semantics.
- ClickHouse replaces Postgres for `CheckResult` and `RumEvent`
  (Postgres continues to hold configuration tables). Materialized
  views compute hourly / daily rollups so dashboards stay fast.
- VictoriaMetrics replaces Prometheus + Pushgateway for time-series
  metrics with 30-day retention.
- Private locations: package the runner image with a one-line deploy
  command so enterprise customers can run it inside their VPC.
- API tokens scoped to specific checks/monitors, with TTL.
- Terraform provider for monitors-as-code users who already live in
  Terraform.

## Phase 3 — RUM depth (months 8–11)

Goal: elevate the RUM story from "collects web vitals" to
"correlates synthetic and real-user signals".

- RUM SDK: add user interaction tracking (clicks, form submissions,
  route changes in SPAs via a `trackRouteChange()` hook).
- Framework integrations: `@insightview/rum-sdk-react`,
  `@insightview/rum-sdk-vue`.
- Source map deobfuscation: customers upload source maps via
  `POST /v1/source-maps`, errors are stack-rewritten server-side.
- Unified dashboard view: synthetic baselines overlaid on RUM
  percentile distributions for the same service / version / page.
- Geo-IP enrichment via MaxMind GeoLite2 (currently null in MVP).
- RUM-driven alert rules: "fire if p95 LCP > 2500ms across > 100
  sessions in 5 minutes".

## Phase 4 — Intelligence + depth (months 12–18)

Goal: differentiating features — ML-powered alerting, session replay,
compliance.

- Anomaly detection pipeline: Z-score → Isolation Forest → Prophet
  ensemble. The alert strategy registry already supports plugging in
  new strategies.
- Session replay via rrweb. Privacy-first masking enforced in the
  browser before transport.
- OpenTelemetry trace correlation: synthetic checks inject an OTel
  trace header; customers' backends propagate it; the dashboard shows
  the full synthetic → API → DB trace.
- Public status pages (per-check + aggregate).
- PR deploy gates: `command: status --fail-on-degrade` blocks merges
  if the latest run degraded significantly.
- Multi-tenant RBAC + audit logs + SOC 2 Type II.
- Mobile RUM SDK (iOS/Android).

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
