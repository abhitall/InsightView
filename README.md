# InsightView

**InsightView is an open-source monitoring platform that unifies synthetic
monitoring and real-user monitoring, fully scriptable from GitHub Actions.**

It ships in two modes that share the same monitors-as-code YAML,
assertion vocabulary, and exporter set:

- **Actions-native** — run Playwright monitors end-to-end inside a
  GitHub Actions runner with no separate infrastructure. Recommended
  for most teams. See [ADR 0007](docs/adr/0007-actions-native-synthetic.md)
  for the design and reliability fixes.
- **Platform** — full docker-compose stack with distributed
  scheduler, alerting engine, RUM collector, and React dashboard.
  Recommended when you need central aggregation across many
  monitors, tenants, or regions.

Both modes are first-class. The v1 Action usage is still supported
via `command: legacy-run`, so existing workflows keep working with
zero changes while you migrate.

## What you get

**Synthetic monitoring**
- Containerized Playwright runner that executes checks on your schedule,
  collects Web Vitals with every reliability fix uncovered in the research,
  runs assertions, and captures screenshots to S3/MinIO.
- **Distributed scheduler** — leader-elected cron reconciler with
  dead-man's-switch watchdog so you know when monitoring itself has
  gone quiet.
- **Retry with flaky detection** — transient errors retry, assertion
  failures never do, and a `flaky` marker surfaces intermittents
  without firing alerts.
- **Browser recycling** via `runCheckBatch` caps heap growth on long runs.
- **CDN cache detection** classifies `HIT`/`MISS`/`UNKNOWN` from
  `cf-cache-status`, `x-cache`, `x-vercel-cache`, etc.
- **CDP network emulation** — `fast-3g`, `slow-3g`, `4g`, `offline` presets.

**Real-user monitoring**
- Tree-shakeable browser SDK (`@insightview/rum-sdk`) auto-collects
  Core Web Vitals, JS errors, navigation timings, **click + route-change
  interactions**, and optional **session replay (rrweb)**.
- **Framework integrations**: `@insightview/rum-react`,
  `@insightview/rum-vue`, `@insightview/rum-mobile` (React Native).
- **Edge collector**: `infra/cloudflare-worker` proxies beacons from
  330+ Cloudflare PoPs with cf-geo enrichment.
- **Source map deobfuscation** via `POST /v1/source-maps` +
  `POST /v1/source-maps/resolve`.
- **Geo-IP enrichment** via bundled MaxMind GeoLite2 (`geoip-lite`).

**Alerting engine (5 strategies)**
- `THRESHOLD` — static operator + value on a web vital or duration.
- `CONSECUTIVE_FAILURES` — N-in-a-row before firing.
- `COMPOSITE` — `all`/`any` over other strategies.
- **`ANOMALY_DETECTION`** — rolling z-score over last N runs, with
  direction (higher/lower/both), window, minSamples, zero-variance
  guard. See [ADR 0011](docs/adr/0011-anomaly-detection-strategy.md).
- **`RUM_METRIC`** — fires on p50/p75/p95/mean aggregates over a
  15-minute rolling RUM window with minSampleCount gating.
- Slack / generic webhook / stdout channels, with dedupe by
  `(ruleId, checkId, severity)`.

**Event bus — BullMQ by default, Kafka-ready**
- `@insightview/event-bus` defines the stable interface; the BullMQ
  implementation ships in the MVP compose stack and the Kafka one
  is selected via `BUS_BACKEND=kafka` or `KAFKA_BROKERS`. The runner,
  scheduler, alerting, and API never see which backend is running.
  See [ADR 0010](docs/adr/0010-kafka-event-bus.md).
- **Transactional outbox** (`DomainEvent` table + `OutboxPublisher`
  on the leader scheduler) guarantees at-least-once delivery under
  failure — only wired when Kafka is selected.

**Auth, RBAC, audit**
- Three-mode Bearer token plugin: static `API_TOKEN` env (local dev),
  issued `iv_*` tokens from the `ApiToken` table (SHA-256 hashed at
  rest, role + scopes + TTL), or anonymous read-only fallback.
- `requireRole("admin"|"write"|"read")` route guard.
- `POST /v1/tokens` mints tokens with TTL; `DELETE /v1/tokens/:id`
  revokes.
- `AuditLog` table + `GET /v1/audit` — every mutating request lands
  a row. See [ADR 0012](docs/adr/0012-auth-rbac-otel.md).

**OpenTelemetry + trace correlation**
- `initTracing(service)` wires OTLP/HTTP export via
  `@opentelemetry/sdk-trace-node`. Zero overhead when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is unset — spans still exist and
  propagate, they're just not exported.
- The synthetic-kit injects W3C `traceparent` headers onto every
  navigation request via `context.setExtraHTTPHeaders` so the
  target site's OTel-instrumented backend continues the same
  distributed trace.

**Monitors-as-code (two modes, same YAML)**
- `monitors/*.yaml` deploys to the platform via the GitHub Action's
  `deploy` command AND runs unchanged via `native-run`. Switching
  modes is a command-line flag, not a YAML rewrite.
- **Terraform** HCL modules at `infra/terraform/modules/{monitor,
  alert-rule,channel}` for teams already on Terraform.

**Dashboard + public status page**
- React SPA for checks, runs, alerts, RUM data.
- **Public status page**: `GET /v1/status.json` + `GET /v1/status/*`
  renders an unauthenticated HTML status board with zero dependencies.
- **Grafana dashboards** at `infra/grafana/dashboards/` with a
  synthetic-vs-RUM overlay panel.

**GitHub Action dispatcher (6 commands)**
- `run` — trigger a platform run, wait for terminal.
- `native-run` — execute monitors inside the workflow directly.
- `deploy` — apply monitors-as-code YAML via the API.
- `validate` — Zod-validate YAML with GitHub annotations.
- `status` — query run history. Supports `--fail-on-degrade`,
  `--window N`, `--min-success-ratio F` for **PR deploy gates**.
- `legacy-run` — backwards-compatible v1 path.

**Multi-region deployment**
- **Kubernetes Helm chart** at `infra/helm/insightview/` with
  values for Kafka backend, OTel endpoint, API token, per-service
  replica counts and resources.
- **Actions Runner Controller** manifests at
  `infra/k8s/actions-runner-controller/` deploy three regional
  scale sets (us-east, eu-west, ap-southeast) for Actions-native
  geographic distribution.

## Architecture

```
┌─ USER LAYER ──────────────────────────────────────────────────────┐
│ Dashboard (React) │ GitHub Action (6 cmds) │ REST API │ Terraform │
│ Public status page                                                │
├─ AUTH PLANE ──────────────────────────────────────────────────────┤
│ ApiToken (hashed) │ requireRole(admin/write/read) │ AuditLog     │
├─ CONTROL PLANE ───────────────────────────────────────────────────┤
│ api │ scheduler (leader-elected) │ alerting (5 strategies)       │
│   ├ OutboxPublisher (Kafka only)                                  │
│   ├ WatchdogHeartbeat (dead-man's-switch)                         │
│   └ TimeoutReaper                                                 │
├─ EVENT BUS  (BullMQ default, Kafka via BUS_BACKEND=kafka) ────────┤
│ checks.scheduled │ checks.started │ checks.completed │            │
│ alerts.triggered │ alerts.resolved │ rum.events.ingested          │
├─ DATA PLANE ──────────────────────────────────────────────────────┤
│ runner (synthetic-kit) │ rum-collector │ rum-sdk (web/mobile)     │
│   ├ Web Vitals bundled IIFE + visibilitychange + INP              │
│   ├ Nav Timing fallback │ CDP metrics │ CDN cache detect          │
│   ├ Auth: none/storage-state/form/totp/oauth/vault-oidc           │
│   ├ Net: direct/proxy/mtls/tailscale/wireguard                    │
│   ├ networkEmulation: fast-3g / slow-3g / 4g / offline            │
│   └ OpenTelemetry traceparent on every nav request               │
├─ STORAGE ─────────────────────────────────────────────────────────┤
│ Postgres (Prisma) │ Redis │ Kafka (opt) │ Pushgateway │ MinIO(S3) │
│ Tables: Check, CheckRun, CheckResult, AlertRule, AlertIncident,   │
│         NotificationChannel, RumSession, RumEvent, RumReplayChunk,│
│         SourceMap, WatchdogHeartbeat, MonitorDeployment,          │
│         DomainEvent (outbox), ApiToken, AuditLog                  │
├─ OBSERVABILITY ───────────────────────────────────────────────────┤
│ pino (logs) │ prom-client (metrics) │ OpenTelemetry (traces)      │
│ Grafana dashboards │ /metrics │ /healthz │ /v1/status            │
└───────────────────────────────────────────────────────────────────┘
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the detailed
HLD + LLD, [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phased plan
(Phase 1–4 all delivered except ClickHouse/VictoriaMetrics per
explicit scope decision), [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md)
for the 12-item severity matrix, [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
for deploy recipes, [`docs/MONITORING_RECIPES.md`](docs/MONITORING_RECIPES.md)
for per-app-type playbooks, and [`docs/adr/`](docs/adr/) for the 12
architectural decision records.

## Quick start — end-to-end in one command

```bash
pnpm install
pnpm compose:up        # builds & starts postgres, redis, api, scheduler,
                       # runner, alerting, rum-collector, dashboard,
                       # test-site, minio, pushgateway, prometheus
pnpm e2e:test          # runs the end-to-end assertions
```

When the stack is up:

| Service        | URL                       |
|----------------|---------------------------|
| Dashboard      | http://localhost:5173     |
| API            | http://localhost:4000     |
| RUM collector  | http://localhost:4400     |
| Test site      | http://localhost:8080     |
| Prometheus     | http://localhost:9090     |
| Pushgateway    | http://localhost:9091     |
| MinIO console  | http://localhost:9001     |

Tear down with `pnpm compose:down`.

## GitHub Action usage

### Recommended: Actions-native synthetic monitoring

Zero infrastructure. Runs your monitors directly inside the GitHub
Actions runner, collects Web Vitals with every reliability fix the
research uncovered, and pings a dead-man's-switch on success.

```yaml
# .github/workflows/native-synthetic.yml (see full example in this repo)
on:
  schedule: [{ cron: "*/15 * * * *" }]
  workflow_dispatch:
  repository_dispatch:
    types: [synthetic-run]

jobs:
  monitor:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.51.0-noble
      options: --user 1001 --ipc=host
    steps:
      - uses: actions/checkout@v4
      - uses: abhitall/InsightView@v2
        with:
          command: native-run
          monitors_path: monitors
          heartbeat_url: ${{ secrets.HC_PING_URL }}
```

Write your monitors in `monitors/*.yaml`:

```yaml
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: homepage
spec:
  type: browser
  targetUrl: "https://example.com/"
  timeoutMs: 45000
  assertions:
    - { type: status, value: passed }
    - { type: title-contains, value: "Example Domain" }
    - { type: max-lcp-ms, value: "2500" }
    - { type: max-cls, value: "0.1" }
  native:
    auth: { strategy: none, config: {} }
    network: { profile: direct }
    exporters:
      - { type: stdout }
      - { type: github-artifact, config: { dir: artifacts } }
      - { type: pushgateway, config: { url: "https://pushgateway.example.com" } }
```

The native-run command is built on `@insightview/synthetic-kit`,
which ships every reliability fix the research uncovered:

- Bundled `web-vitals` IIFE + `bypassCSP` + `reportAllChanges` +
  forced `visibilitychange → hidden` so LCP, CLS, and INP actually
  resolve in headless Chromium.
- Navigation Timing API as a guaranteed fallback — if web-vitals
  fails, you still get TTFB, FCP, DNS, TLS, DCL, and load time.
- 4-category error classification (`TARGET_DOWN` / `TARGET_ERROR` /
  `INFRA_FAILURE` / `PARTIAL`) so alerting can distinguish "your
  site is down" from "our CI broke".
- 6 auth strategies: `none`, `storage-state`, `form-login`,
  `totp`, `oauth-client-credentials`, `vault-oidc` (with
  dual-credential rotation).
- 5 network profiles: `direct`, `proxy`, `mtls`, `tailscale`,
  `wireguard`. Tailscale support is workflow-level — drop in
  `tailscale/github-action@v4` before the InsightView step.
- 6 exporters: `stdout`, `pushgateway`, `s3`, `github-artifact`,
  `healthchecks`, `platform`. Combine as needed.
- Retry-with-flaky tracking, CDN cache hit/miss detection,
  CDP network emulation, browser recycling.
- **OpenTelemetry traceparent** injected on every navigation so
  the target's backend continues the same distributed trace.

### PR deploy gate — fail on degrade

Block merges when the target's latest synthetic run degraded:

```yaml
on:
  pull_request:
jobs:
  monitor-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: abhitall/InsightView@v2
        with:
          command: status
          api_url: ${{ secrets.INSIGHTVIEW_API_URL }}
          api_token: ${{ secrets.INSIGHTVIEW_API_TOKEN }}
          check_name: production-homepage
        env:
          # Also acceptable as a flag on the argv:
          INSIGHTVIEW_FAIL_ON_DEGRADE: "true"
```

The `status` command also supports `--window N` and
`--min-success-ratio F` flags. It exports `latest_status` and
`success_ratio` as step outputs so later steps can react.

### New: trigger a platform run

```yaml
- uses: abhitall/InsightView@v2
  with:
    command: run
    api_url: ${{ secrets.INSIGHTVIEW_API_URL }}
    api_token: ${{ secrets.INSIGHTVIEW_API_TOKEN }}
    check_name: homepage-health
    wait: "true"
```

### New: deploy monitors-as-code on merge

```yaml
on:
  push:
    branches: [main]
    paths: [monitors/**]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: abhitall/InsightView@v2
        with:
          command: deploy
          api_url: ${{ secrets.INSIGHTVIEW_API_URL }}
          api_token: ${{ secrets.INSIGHTVIEW_API_TOKEN }}
          monitors_path: monitors
```

### New: validate monitors on PR

```yaml
on:
  pull_request:
    paths: [monitors/**]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: abhitall/InsightView@v2
        with:
          command: validate
          monitors_path: monitors
```

### New: query status from CI

```yaml
- uses: abhitall/InsightView@v2
  with:
    command: status
    api_url: ${{ secrets.INSIGHTVIEW_API_URL }}
    check_name: homepage-health
```

### Backwards compatible: v1 behavior

Existing workflows that run a standalone Playwright test with
Pushgateway + S3 uploads keep working — just use `command: legacy-run`
(or omit `command`; it's the default):

```yaml
- uses: abhitall/InsightView@v2
  with:
    command: legacy-run
    test_url: 'https://example.com'
    prometheus_pushgateway: ${{ secrets.PROMETHEUS_PUSHGATEWAY }}
    aws_access_key_id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws_secret_access_key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws_region: ${{ secrets.AWS_REGION }}
    s3_bucket: ${{ secrets.S3_BUCKET }}
    browser: 'chromium'
```

This runs the original Playwright fixture path preserved under
`apps/runner/src/legacy/`.

## Monitors-as-code

Check and alert definitions live in YAML:

```yaml
# monitors/test-site-home.yaml
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: test-site-home
  description: "Synthetic check against the demo test-site"
  tags: ["e2e"]
spec:
  type: browser
  schedule: "*/5 * * * *"
  targetUrl: "https://test-site.example.com"
  timeoutMs: 45000
  assertions:
    - type: status
      value: passed
    - type: body-contains
      value: "Welcome"
---
apiVersion: insightview.io/v1
kind: AlertRule
metadata:
  name: test-site-home-fail
spec:
  checkName: test-site-home
  strategy: CONSECUTIVE_FAILURES
  expression:
    threshold: 1
  severity: CRITICAL
  channels:
    - stdout
```

## Alert strategies

Five strategies ship in `apps/alerting`. Each slots into the
registry via one map entry; adding a sixth is a new file.

### `THRESHOLD` — static operator + value

```yaml
kind: AlertRule
spec:
  strategy: THRESHOLD
  expression:
    metric: LCP          # or "duration", "CLS", "FCP", "TTFB", "INP"
    operator: ">"        # ">", ">=", "<", "<=", "=="
    value: 2500
  severity: WARNING
```

### `CONSECUTIVE_FAILURES` — N-in-a-row

```yaml
kind: AlertRule
spec:
  strategy: CONSECUTIVE_FAILURES
  expression: { threshold: 3 }  # three failures in a row
  severity: CRITICAL
```

### `COMPOSITE` — AND / OR over sub-rules

```yaml
kind: AlertRule
spec:
  strategy: COMPOSITE
  expression:
    all:                 # or: any
      - strategy: THRESHOLD
        expression: { metric: LCP, operator: ">", value: 2500 }
      - strategy: CONSECUTIVE_FAILURES
        expression: { threshold: 2 }
  severity: CRITICAL
```

### `ANOMALY_DETECTION` — rolling z-score

Catches "yesterday it was 1200ms, today it's 4500ms" regressions
that static thresholds miss. Uses the last `window` historical
samples as the baseline. See
[ADR 0011](docs/adr/0011-anomaly-detection-strategy.md).

```yaml
kind: AlertRule
spec:
  strategy: ANOMALY_DETECTION
  expression:
    metric: LCP          # or CLS, FCP, TTFB, duration, ...
    threshold: 3.0       # z-score cutoff (default 3.0)
    window: 20           # last-N baseline (default 20)
    minSamples: 5        # min samples before firing (default 5)
    direction: higher    # "higher" | "lower" | "both"
  severity: WARNING
```

### `RUM_METRIC` — real-user percentile aggregate

Fires on aggregated RUM data rather than the current synthetic
run. The evaluator pre-computes the aggregate over a 15-minute
window before calling the strategy.

```yaml
kind: AlertRule
spec:
  strategy: RUM_METRIC
  expression:
    metric: LCP
    percentile: p75      # "p50" | "p75" | "p95" | "mean"
    operator: ">"
    value: 2500
    minSampleCount: 100  # gate tiny samples
  severity: CRITICAL
```

## RUM SDK

Drop into any HTML page:

```html
<script src="https://cdn.example.com/insightview-rum.iife.js"></script>
<script>
  InsightViewRUM.init({
    endpoint: "https://rum.example.com/v1/events",
    siteId: "my-site",
    sampleRate: 1,
    release: "app@1.2.3",
    environment: "production",
    autoInstrument: {
      webVitals: true,
      errors: true,
      navigation: true,
      interactions: true,   // click + route-change tracking
      replay: true,         // rrweb session replay
    },
    replaySampleRate: 0.05, // 5% of sessions get replay
  });
</script>
```

Or via an ESM import in a bundled app:

```ts
import { init } from "@insightview/rum-sdk";

init({
  endpoint: "https://rum.example.com/v1/events",
  siteId: "my-site",
  autoInstrument: {
    webVitals: true,
    errors: true,
    navigation: true,
    interactions: true,
    resources: false,
  },
});
```

### React integration

```tsx
import { RumProvider, useRumClient } from "@insightview/rum-react";

function App() {
  return (
    <RumProvider options={{
      endpoint: "https://rum.example.com/v1/events",
      siteId: "my-site",
    }}>
      <AppRoutes />
    </RumProvider>
  );
}

function CheckoutButton() {
  const rum = useRumClient();
  return (
    <button onClick={() => rum.trackEvent("checkout-click")}>
      Checkout
    </button>
  );
}
```

### Vue integration

```ts
import { createApp } from "vue";
import { InsightViewRum } from "@insightview/rum-vue";
import App from "./App.vue";

createApp(App).use(InsightViewRum, {
  endpoint: "https://rum.example.com/v1/events",
  siteId: "my-site",
});
```

### Mobile (React Native)

```ts
import { init } from "@insightview/rum-mobile";

const client = init({
  endpoint: "https://rum.example.com/v1/events",
  siteId: "my-app",
  platform: "react-native",
  appVersion: "1.2.3",
});

client.trackNavigation("ProductList");
client.trackEvent("add-to-cart", { productId: "P123" });
```

## Authentication & audit

Three-mode Bearer auth on the API. See
[ADR 0012](docs/adr/0012-auth-rbac-otel.md) for the design.

```bash
# Static API_TOKEN mode (local dev)
export API_TOKEN=$(openssl rand -hex 32)

# Or mint scoped tokens via the admin API
curl -X POST https://api.example.com/v1/tokens \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-deploy","role":"write","scopes":["monitors:deploy"],"expiresInDays":30}'
# returns { "raw": "iv_...", "id": "...", ... } — the raw token
# is only returned here; lose it and mint a new one.
```

Every mutating request creates an `AuditLog` row queryable via
`GET /v1/audit?resource=ApiToken&limit=50` (requires `write`
role or above).

## Repository layout

```
packages/
  core/            - shared types, enums, event envelopes
  db/              - Prisma schema + repositories (Postgres)
                     Tables: Check, CheckRun, CheckResult, AlertRule,
                     AlertIncident, NotificationChannel, RumSession,
                     RumEvent, RumReplayChunk, SourceMap,
                     WatchdogHeartbeat, MonitorDeployment,
                     DomainEvent (outbox), ApiToken, AuditLog
  event-bus/       - EventBus interface + BullMQ AND Kafka impls
                     (+ KafkaScheduler via node-cron, outbox-aware)
  observability/   - pino + prom-client + OpenTelemetry
                     (initTracing, withSpan, injectTraceHeaders)
  rum-sdk/         - browser RUM SDK (esbuild IIFE build)
                     Instruments: webVitals, errors, navigation,
                     resources, replay (rrweb), interactions
  rum-react/       - React hooks + provider for the RUM SDK
  rum-vue/         - Vue 3 plugin for the RUM SDK
  rum-mobile/      - React Native / iOS / Android compatible SDK
  synthetic-kit/   - Playwright-based synthetic runner library
                     (shared by platform runner AND native-run)
                     Auth: none, storage-state, form-login, totp,
                     oauth-client-credentials, vault-oidc
                     Network profiles + CDP network emulation +
                     CDN cache detect + retry-flaky + OTel traceparent

apps/
  api/               - Fastify REST API
                       Routes:
                         /v1/checks, /v1/runs, /v1/runs/:id/results
                         /v1/alert-rules, /v1/incidents, /v1/channels
                         /v1/rum/events, /v1/rum/sessions, /v1/rum/summary
                         /v1/monitors/apply, /v1/monitors/validate
                         /v1/runs/ingest            (Actions-native bridge)
                         /v1/source-maps, /v1/source-maps/resolve
                         /v1/tokens                 (mint/revoke, admin)
                         /v1/audit                  (audit log query)
                         /v1/status.json, /v1/status/*  (public page)
                         /healthz, /readyz, /metrics
  scheduler/         - Leader-elected cron reconciler + watchdog +
                       OutboxPublisher (Kafka mode) + timeoutReaper
  runner/            - Platform-mode runner (thin wrapper around
                       synthetic-kit, see ADR 0008)
  runner/src/legacy/ - Preserved v1 Playwright fixture path
  alerting/          - Strategy evaluator: THRESHOLD,
                       CONSECUTIVE_FAILURES, COMPOSITE,
                       ANOMALY_DETECTION, RUM_METRIC
                     + channels: stdout, slack-webhook, generic-webhook
  rum-collector/     - Fastify RUM intake + replay + geoip-lite
  dashboard/         - Vite + React SPA
  action-dispatcher/ - CLI powering the composite GitHub Action
                       (6 commands: run, native-run, deploy, validate,
                        status, legacy-run)

infra/
  docker-compose.yml                        - Full stack (Kafka behind --profile kafka)
  docker/                                   - Service Dockerfiles
  prometheus/prometheus.yml                 - Scrape config
  test-site/                                - nginx-served HTML + SDK
  e2e/                                      - End-to-end test harness
  grafana/dashboards/                       - Grafana JSON dashboards
                                              (synthetic + RUM overlay)
  cloudflare-worker/                        - Edge RUM collector
  k8s/actions-runner-controller/            - ARC manifests for multi-region
  helm/insightview/                         - Helm chart (Chart.yaml,
                                              values.yaml, templates/)
  terraform/modules/{monitor,alert-rule,channel}/  - HCL modules

monitors/
  *.yaml           - Monitors-as-code definitions

.github/workflows/
  ci.yml                          - typecheck + unit tests on every push
  native-synthetic.yml            - Actions-native monitoring (triple-triggered)
  run-check.yml                   - command: run (platform mode)
  deploy-monitors.yml             - command: deploy
  validate-monitors.yml           - command: validate
  e2e.yml                         - full stack end-to-end gate (label-gated)
  legacy-synthetic-monitoring.yml - v1 cron workflow (deprecated)

docs/
  ARCHITECTURE.md          - HLD + LLD, sequence diagrams, seams
  ROADMAP.md               - Phased plan (Phase 1–4 delivered)
  GAP_ANALYSIS.md          - 12-item severity matrix
  MONITORING_RECIPES.md    - Per-app-type + auth + anomaly recipes
  OPERATIONS.md            - Helm / Terraform / Kafka deploy recipes
  SECRETS_CONFIGURATION.md - All environment variables
  adr/0001..0012-*.md      - 12 architectural decision records
```

## Local development

```bash
pnpm install
pnpm typecheck           # typecheck all workspaces
pnpm test:unit           # 41 unit tests (errors, assertions, strategies, parsers)
pnpm build               # compile all workspaces
pnpm compose:up          # full-stack dev loop (BullMQ event bus)
pnpm compose:logs        # tail all service logs
pnpm compose:down        # stop and remove volumes
```

### Running on Kafka locally

The Kafka backend is opt-in via a compose profile so the default
`compose:up` stays fast. To run against Kafka:

```bash
# Start the Kafka broker (Bitnami KRaft mode, no ZooKeeper)
docker compose -f infra/docker-compose.yml --profile kafka up -d kafka

# Start the rest of the stack with BUS_BACKEND=kafka
BUS_BACKEND=kafka KAFKA_BROKERS=kafka:9092 pnpm compose:up
```

The `@insightview/event-bus` factory auto-detects the backend from
`BUS_BACKEND` or the presence of `KAFKA_BROKERS`. Switching is a
pure env-var change — no application code changes required.
See [ADR 0010](docs/adr/0010-kafka-event-bus.md).

### Running native-run locally

Even without any platform stack you can run Actions-native monitors:

```bash
# Run a single monitor file
CHROMIUM_EXECUTABLE_PATH=$(pnpm --filter @insightview/runner exec playwright show-path chromium 2>/dev/null || echo "") \
INSIGHTVIEW_MONITORS_PATH=monitors/example-com.yaml \
pnpm --filter @insightview/action-dispatcher start native-run

# Or run every YAML in a directory
INSIGHTVIEW_MONITORS_PATH=monitors/ \
pnpm --filter @insightview/action-dispatcher start native-run
```

Individual services:

```bash
pnpm --filter @insightview/api run dev          # watch-reload the API
pnpm --filter @insightview/dashboard run dev    # watch-reload the dashboard
pnpm --filter @insightview/rum-sdk run build    # build the SDK IIFE
pnpm --filter @insightview/rum-mobile run build # build the mobile SDK
```

### Enabling OpenTelemetry tracing

Set the OTLP endpoint and every service auto-exports spans:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
pnpm compose:up
```

The synthetic-kit also injects `traceparent` headers on every
Playwright navigation, so the target's OTel-instrumented backend
continues the same trace. See [ADR 0012](docs/adr/0012-auth-rbac-otel.md).

## Production deployment

InsightView ships three production deploy paths. See
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) for the full guide.

### 1. Kubernetes via Helm

```bash
helm install insightview ./infra/helm/insightview \
  --namespace insightview --create-namespace \
  --set database.url=postgres://... \
  --set eventBus.backend=kafka \
  --set eventBus.kafkaBrokers=kafka-0:9092,kafka-1:9092 \
  --set otel.enabled=true \
  --set otel.exporterEndpoint=http://otel-collector:4318/v1/traces \
  --set apiToken=$(openssl rand -hex 32)
```

### 2. Multi-region Actions-native runners via ARC

```bash
kubectl apply -f infra/k8s/actions-runner-controller/namespace.yaml
kubectl apply -f infra/k8s/actions-runner-controller/runner-scale-set.yaml
```

Deploys three regional scale sets (us-east, eu-west, ap-southeast).
Workflows target them via `runs-on: [self-hosted, insightview, us-east]`.

### 3. Terraform HCL modules

```hcl
module "homepage" {
  source = "github.com/abhitall/insightview//infra/terraform/modules/monitor"
  api_url   = var.insightview_api_url
  api_token = var.insightview_api_token
  name       = "homepage"
  schedule   = "*/5 * * * *"
  target_url = "https://example.com/"
  assertions = [
    { type = "status",     value = "passed" },
    { type = "max-lcp-ms", value = "2500" },
  ]
}
```

## Running the end-to-end test

The `infra/e2e/e2e.ts` script exercises every layer of the platform:

1. Waits for `/healthz` on the API.
2. Deploys a monitor via `POST /v1/monitors/apply`.
3. Triggers a synthetic run and polls until terminal.
4. Asserts the result lands in Postgres (via the REST API).
5. Asserts Prometheus Pushgateway received `synthetic_monitoring_*` metrics.
6. Asserts MinIO received a screenshot artifact.
7. Drives the test-site with a real headless Chromium to fire RUM events.
8. Asserts the RUM collector persisted Web Vital + navigation events.
9. Triggers a guaranteed-fail check and verifies an alert incident fires.

```bash
pnpm e2e:up       # docker compose up --wait
pnpm e2e:test     # run the assertion suite
pnpm e2e:down     # tear down
# or all-in-one:
pnpm e2e          # up, test, down (propagates test exit code)
```

## License

MIT — see LICENSE.
