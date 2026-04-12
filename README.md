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

- **Synthetic monitoring** — containerized Playwright runner that
  executes checks on your schedule, collects Web Vitals, runs
  assertions, and captures screenshots to S3/MinIO.
- **Real-user monitoring** — tree-shakeable browser SDK collects
  Core Web Vitals, JS errors, and navigation timings via
  `navigator.sendBeacon`.
- **Distributed scheduler** — leader-elected, reconciles checks from
  the database, keeps a dead-man's-switch watchdog so you know when
  monitoring itself has gone quiet.
- **Alerting engine** — threshold, consecutive-failures, and composite
  strategies with Slack / webhook / stdout notification channels.
- **Monitors-as-code** — check and alert rule definitions live in
  YAML in your repo, deployed via the GitHub Action.
- **Dashboard** — React SPA for checks, runs, alerts, and RUM data.
- **GitHub Action dispatcher** — a single `action.yml` exposes every
  platform capability: `run | deploy | validate | status | legacy-run`.

## Architecture

```
┌─ user layer ──────────────────────────────────────────────────────┐
│ Dashboard (React) │ REST API │ GitHub Action │ monitors-as-code  │
├─ control plane ───────────────────────────────────────────────────┤
│ api │ scheduler │ alerting                                       │
├─ event bus (BullMQ today → Kafka Phase 2) ───────────────────────┤
│ checks.scheduled │ checks.completed │ alerts.triggered │ rum.*   │
├─ data plane ──────────────────────────────────────────────────────┤
│ runner (Playwright) │ rum-collector (Fastify) │ rum-sdk (browser) │
├─ storage ─────────────────────────────────────────────────────────┤
│ PostgreSQL │ Redis │ Pushgateway │ MinIO (S3)                    │
└───────────────────────────────────────────────────────────────────┘
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the detailed
HLD + LLD, [`docs/ROADMAP.md`](docs/ROADMAP.md) for the 18-month
phased plan, [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md) for the
12-item severity matrix, and [`docs/adr/`](docs/adr/) for the
architectural decisions behind the MVP.

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
- Strategy-pattern auth: `none`, `storage-state`, `form-login`,
  `totp`, `oauth-client-credentials`. MFA is a one-liner.
- Strategy-pattern network: `direct`, `proxy`, `mtls`, `tailscale`,
  `wireguard`. Tailscale support is workflow-level — drop in
  `tailscale/github-action@v4` before the InsightView step.
- 6 exporters: `stdout`, `pushgateway`, `s3`, `github-artifact`,
  `healthchecks`, `platform`. Combine as needed.

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
    resources: false,
  },
});
```

## Repository layout

```
packages/
  core/            - shared types, enums, event envelopes
  db/              - Prisma schema + repositories (Postgres)
  event-bus/       - EventBus interface + BullMQ impl
  observability/   - pino + prom-client helpers
  rum-sdk/         - browser RUM SDK (esbuild IIFE build)

apps/
  api/               - Fastify REST API + metrics + monitors-as-code
  scheduler/         - Leader-elected cron reconciler + watchdog
  runner/            - Playwright-based check executor
  runner/src/legacy/ - Preserved v1 Playwright fixture path
  alerting/          - Strategy evaluator + channel dispatcher
  rum-collector/     - Fastify RUM intake + validation
  dashboard/         - Vite + React SPA
  action-dispatcher/ - CLI powering the composite GitHub Action

infra/
  docker-compose.yml        - Full stack
  docker/                   - Service Dockerfiles
  prometheus/prometheus.yml - Scrape config
  test-site/                - nginx-served HTML + RUM SDK bundle
  e2e/                      - End-to-end test harness

monitors/
  *.yaml           - Monitors-as-code definitions

.github/workflows/
  run-check.yml                   - command: run
  deploy-monitors.yml             - command: deploy
  validate-monitors.yml           - command: validate
  e2e.yml                         - full stack end-to-end gate
  legacy-synthetic-monitoring.yml - v1 cron workflow (deprecated)

docs/
  ARCHITECTURE.md
  ROADMAP.md
  GAP_ANALYSIS.md
  adr/0001..0006-*.md
  SECRETS_CONFIGURATION.md
```

## Local development

```bash
pnpm install
pnpm typecheck           # typecheck all workspaces
pnpm build               # compile all workspaces
pnpm compose:up          # full-stack dev loop
pnpm compose:logs        # tail all service logs
pnpm compose:down        # stop and remove volumes
```

Individual services:

```bash
pnpm --filter @insightview/api run dev          # watch-reload the API
pnpm --filter @insightview/dashboard run dev    # watch-reload the dashboard
pnpm --filter @insightview/rum-sdk run build    # build the SDK IIFE
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
