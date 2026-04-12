# Gap Analysis

This is the 12-item severity matrix that shaped the InsightView MVP
vertical slice. It captures where the v1 GitHub Action was relative
to production monitoring platforms, and — for each gap — what the
MVP now delivers and what remains deferred to the roadmap.

| # | Area | Severity | MVP status | Details |
|---|------|----------|------------|---------|
| 1 | Geographic distribution | Critical | Partial | Containerized runner is region-agnostic and ships as `@insightview/runner`. Multi-region Kafka-sharded deployment is Phase 2. |
| 2 | Alerting & incident management | Critical | Delivered | `apps/alerting` with threshold, consecutive-failures, composite strategies. Slack/webhook/stdout channels. Dedupe by `(ruleId,checkId,severity)`. Anomaly ML deferred to Phase 4. |
| 3 | Self-monitoring & observability | Critical | Delivered | Leader-elected scheduler heartbeats `WatchdogHeartbeat`, `/healthz` reports stale if > 3× interval. Timeout reaper closes stuck runs. `/metrics` exposes Prometheus counters. |
| 4 | Multi-environment support | Critical | Partial | Runner is a standalone Docker image; customers can deploy it inside their VPC today. VPN/proxy-per-check config is Phase 2. |
| 5 | Data retention & analytics | High | Partial | PostgreSQL holds checks, runs, results, RUM events. Configurable retention and rollups come with the ClickHouse + VictoriaMetrics migration in Phase 2. |
| 6 | Compliance & audit | High | Partial | `MonitorDeployment` row logs every monitors-as-code change. RBAC, SOC 2, HIPAA all Phase 4. |
| 7 | Authentication & credentials | High | Partial | `API_TOKEN` env var gates non-health endpoints. Vault integration, OAuth 2 token rotation, and tenant-scoped tokens are Phase 1–2. |
| 8 | Scalability | High | Delivered | Scheduler decouples from runner via event bus. Runner is horizontally scalable; claim semantics are idempotent. Kafka adoption (Phase 2) removes the Redis bottleneck for very high throughput. |
| 9 | RUM capability | High | Delivered | `@insightview/rum-sdk` (IIFE) + `apps/rum-collector`. Auto web-vitals, errors, navigation; `sendBeacon` transport; session stitching via sessionStorage. |
| 10 | Cost optimization | Medium | Partial | Per-check frequency via cron; runner cold-starts browser per run. Browser pre-warming + adaptive scheduling are Phase 2. |
| 11 | Extensibility & plugins | Medium | Delivered | Strategy + channel registries make adding plugins a one-file operation. REST API + monitors-as-code YAML already expose every surface the action dispatcher needs. |
| 12 | Configuration management | Low | Delivered | Monitors-as-code YAML flows through `POST /v1/monitors:apply` → Postgres, with Zod validation. Action dispatcher exposes `deploy` and `validate` subcommands. |

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

- **Critical gaps 1 and 3** are fully addressed in the MVP.
- **Critical gap 2** (alerting) is addressed with the 3 evaluator
  strategies covering the 80% of use cases; anomaly detection lands
  in Phase 4.
- **Critical gap 4** is addressed with the standalone runner image;
  network-level policy features (VPN/proxy/private mesh) come in
  Phase 2.

See `docs/ROADMAP.md` for the full phased plan and `docs/ARCHITECTURE.md`
for how each gap is technically addressed.
