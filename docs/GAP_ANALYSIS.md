# Gap Analysis

This is the 12-item severity matrix that shaped the InsightView MVP
vertical slice. It captures where the v1 GitHub Action was relative
to production monitoring platforms, and — for each gap — what the
MVP now delivers and what remains deferred to the roadmap.

| # | Area | Severity | Status | Details |
|---|------|----------|--------|---------|
| 1 | Geographic distribution | Critical | **Delivered** | Self-hosted runners via ARC manifests at `infra/k8s/actions-runner-controller/` (`minRunners: 1` per region across us-east, eu-west, ap-southeast). Cloudflare Worker edge collector pushes RUM from 330+ PoPs. Platform runner remains region-agnostic. |
| 2 | Alerting & incident management | Critical | **Delivered** | `apps/alerting` with 5 strategies — threshold, consecutive-failures, composite, **anomaly detection (z-score)**, **RUM-metric aggregate**. Slack/webhook/stdout channels. Dedupe by `(ruleId,checkId,severity)`. Dead-man's-switch via Healthchecks exporter. **16 unit tests** cover the strategies (see ADR 0011). |
| 3 | Self-monitoring & observability | Critical | **Delivered** | Leader-elected scheduler heartbeats `WatchdogHeartbeat`, `/healthz` reports stale if > 3× interval. Timeout reaper closes stuck runs. `/metrics` exposes Prometheus counters. Grafana dashboards in `infra/grafana/dashboards/`. |
| 4 | Multi-environment support | Critical | **Delivered** | Runner is a standalone Docker image (and synthetic-kit runs anywhere Node + Playwright run). Network profiles: `direct`, `proxy`, `mtls`, `tailscale`, `wireguard`. `mtls` profile reads base64 cert+key from env. |
| 5 | Data retention & analytics | High | Partial | PostgreSQL holds checks, runs, results, RUM events, source maps, replay chunks, domain events, audit logs, API tokens. Configurable retention deferred to ClickHouse migration (explicitly out-of-scope per user request). |
| 6 | Compliance & audit | High | **Delivered** | Full `AuditLog` table + `GET /v1/audit` route + `recordAudit` helper wired into every write path. `ApiToken` table with hashed storage + scoped roles + TTL. RBAC enforced via `requireRole` Fastify pre-handler. SOC 2 Type II certification is a business-process item, not code. |
| 7 | Authentication & credentials | High | **Delivered** | Three-mode auth plugin: static `API_TOKEN`, issued `iv_*` tokens (hashed in DB, role + scopes + TTL), anonymous read. Synthetic-kit auth strategies: `none`, `storage-state`, `form-login`, `totp` (otpauth), `oauth-client-credentials`, `vault-oidc` (with dual-credential rotation). |
| 8 | Scalability | High | **Delivered** | Scheduler decouples from runner via event bus. Runner is horizontally scalable; claim semantics are idempotent. `runCheckBatch` recycles the browser every N runs. **Kafka backend** (ADR 0010) removes the Redis bottleneck for very high throughput; factory selects via `BUS_BACKEND=kafka`. **Transactional outbox** guarantees at-least-once delivery under failure. |
| 9 | RUM capability | High | **Delivered** | `@insightview/rum-sdk` (IIFE + ESM) + `apps/rum-collector`. Auto web-vitals, errors, navigation, resources, **session replay (rrweb)**, **click + route-change interactions**. Source map upload + server-side deobfuscation. React, Vue, **and mobile (React Native)** integration packages. Cloudflare Worker edge collector. **Geo-IP enrichment** via bundled GeoLite2. **RUM-driven alert rules** (`RUM_METRIC` strategy). |
| 10 | Cost optimization | Medium | **Delivered** | Per-check frequency via cron; `runCheckBatch` eliminates cold-start cost. `networkEmulation` CDP throttling for realistic baselines without extra infra. Free-tier Healthchecks + free-tier Cloudflare Worker keeps operational cost near zero. |
| 11 | Extensibility & plugins | Medium | **Delivered** | Strategy + channel registries make adding plugins a one-file operation. REST API + monitors-as-code YAML already expose every surface the action dispatcher needs. Source-map upload endpoint, replay chunk endpoint, platform ingest endpoint are all plug-in style. |
| 12 | Configuration management | Low | **Delivered** | Monitors-as-code YAML flows through `POST /v1/monitors/apply` → Postgres, with Zod validation. Action dispatcher exposes `deploy` and `validate` subcommands. YAML is a *superset* of the platform schema so native-run uses the same files. |

## What each severity means

- **Critical**: production monitoring is unreliable or broken
  without it. The MVP must not ship without at least a partial answer.
- **High**: customers will rate the platform "incomplete" without it
  but can work around it short-term.
- **Medium**: useful differentiation; absence does not block
  adoption.
- **Low**: nice to have; easy to bolt on later.

## What "Delivered" vs "Partial" mean

- **Delivered**: a working implementation exists in the MVP vertical
  slice and is exercised by the end-to-end test.
- **Partial**: a primitive of the feature exists (e.g., the runner
  image for multi-environment, or `API_TOKEN` for auth) but the full
  feature requires roadmap work.

## Severity-to-phase map

- **All 4 Critical gaps are now Delivered** after iteration 3:
  geographic distribution via ARC + Cloudflare Worker edge, alerting
  with dead-man's-switch, self-monitoring via watchdog + Grafana,
  and multi-environment via the 5 network profiles.
- **6 of 8 High/Medium/Low gaps are Delivered**; the two that
  remain Partial are data retention/analytics (waiting on
  ClickHouse in Phase 2) and compliance/audit (SOC 2 Type II
  certification is a Phase 4 business-process item, not code).

## What Iteration 3 added on top of the original MVP

- `packages/synthetic-kit` now also provides: CDP network
  throttling, CDN cache hit/miss detection, retry-with-flaky,
  runCheckBatch (browser recycling), Vault OIDC auth with
  dual-credential rotation.
- `apps/runner` migrated to be a thin wrapper around
  `synthetic-kit` (ADR 0008), eliminating the drift risk between
  platform and Actions-native modes.
- `apps/api`: `POST /v1/runs/ingest` bridge endpoint so the
  `platform` exporter works; `POST /v1/source-maps` +
  `/v1/source-maps/resolve` for RUM error deobfuscation.
- `packages/rum-sdk` adds `installReplay` (rrweb backed, opt-in,
  privacy-masked).
- `apps/rum-collector` adds `POST /v1/replay` for session replay
  chunks.
- `packages/db` adds `SourceMap` and `RumReplayChunk` tables.
- New workspace packages: `@insightview/rum-react`,
  `@insightview/rum-vue`.
- `infra/cloudflare-worker` edge RUM collector.
- `infra/grafana/dashboards/{synthetic,rum}.json` Grafana templates.
- `infra/k8s/actions-runner-controller/` manifests for multi-
  region self-hosted runners.
- `vitest` suite with **33 unit tests** across synthetic-kit
  (errors, assertions, spec parser), alerting strategies, and
  monitorsYaml parser. Runs on every CI push.
- `docs/MONITORING_RECIPES.md` with SPA, SSR, static, CDN-fronted,
  API, and authenticated-flow examples.
- ADR 0008 (runner unification), ADR 0009 (session replay + RUM depth).

See `docs/ROADMAP.md` for the full phased plan and `docs/ARCHITECTURE.md`
for how each gap is technically addressed.
