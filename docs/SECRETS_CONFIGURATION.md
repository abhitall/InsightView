# Configuration reference

Every environment variable and GitHub Secret used by the
InsightView platform, grouped by concern. Defaults in the
table are what the service picks when the variable is unset.

> **Legacy v1 note.** The bottom of this file preserves the
> original AWS/MinIO secrets reference for users still on the
> `command: legacy-run` path. Everything above that section is
> for the platform + Actions-native modes.

## Platform API (apps/api)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port the API listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | — | Postgres connection string (required) |
| `REDIS_URL` | `redis://redis:6379` | Used only when the event bus backend is BullMQ |
| `BUS_BACKEND` | auto-detect | `bullmq` or `kafka`. Auto-detects `kafka` when `KAFKA_BROKERS` is set |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated list of Kafka brokers |
| `KAFKA_CLIENT_ID` | `insightview` | Client id reported to Kafka |
| `API_TOKEN` | — | Shared secret for Bearer auth (any match → admin role) |
| `LOG_LEVEL` | `info` | pino log level |

## Scheduler (apps/scheduler)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4100` | Health endpoint port |
| `DATABASE_URL` | — | Same Postgres as the API |
| `REDIS_URL` | `redis://redis:6379` | Leader-election lease AND BullMQ store |
| `BUS_BACKEND` | auto | Same semantics as the API |
| `KAFKA_BROKERS` | `localhost:9092` | Only used when Kafka is selected |

The outbox publisher loop runs **only when Kafka is the
selected backend**. BullMQ mode keeps the schedule-loop and the
direct-publish path because BullMQ's guarantees are already
sufficient.

## Runner (apps/runner)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4200` | Health endpoint port |
| `RUNNER_ID` | random | Runner identity for leader-election races and logs |
| `DATABASE_URL` | — | Required |
| `REDIS_URL` / `KAFKA_BROKERS` / `BUS_BACKEND` | — | Same semantics as scheduler |
| `PROMETHEUS_PUSHGATEWAY` | — | Optional — emit `synthetic_monitoring_*` metrics |
| `CHROMIUM_EXECUTABLE_PATH` | — | Override Playwright's bundled browser (useful in air-gapped CI) |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_TLS_VERIFY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | — | S3/MinIO credentials for the `s3` exporter |

## Alerting (apps/alerting)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4300` | Health endpoint port |
| `DATABASE_URL` | — | Required |
| `REDIS_URL` / `KAFKA_BROKERS` / `BUS_BACKEND` | — | Same semantics |
| `RUM_SITE_ID` | `default` | Site id the `RUM_METRIC` evaluator queries for aggregates |

## RUM collector (apps/rum-collector)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4400` | HTTP port |
| `DATABASE_URL` | — | Required |
| `RUM_RATE_LIMIT` | `600` | Per-minute beacon rate limit (key: siteId+IP) |
| `LOG_LEVEL` | `info` | |

Geo-IP enrichment uses the bundled `geoip-lite` GeoLite2
snapshot — no license file is needed for country-level
resolution. For city-level or newer data, run
`npx geoip-lite-update` against your deployment's
`node_modules/geoip-lite` directory as a post-install step.

## Observability (shared)

| Variable | Default | Purpose |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP endpoint. When set, every service batch-exports spans there |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Trace-only override; takes precedence over the generic endpoint |
| `OTEL_SERVICE_NAME` | each service's own name | Overrides the auto-set service name in exported spans |

When no OTLP endpoint is configured, tracing is still enabled
in-process — spans are created, `traceparent` headers propagate
through the event bus and into synthetic navigations — but the
exporter is a no-op. This lets you flip on OTel in production
without forcing every developer to run a local collector.

## Synthetic-kit runtime (used by both modes)

These are read by `@insightview/synthetic-kit` directly
regardless of whether it runs inside the platform runner or
via `command: native-run`.

| Variable | Default | Purpose |
|---|---|---|
| `CHROMIUM_EXECUTABLE_PATH` | — | Override Playwright's bundled browser |
| `INSIGHTVIEW_LOCATION` | `github-actions` | Stamps the `location` field on every envelope |

### Auth strategies (synthetic-kit)

Strategies are selected in the monitor YAML via
`spec.native.auth.strategy`. Each reads a different set of env
vars:

| Strategy | Env vars |
|---|---|
| `none` | — |
| `storage-state` | `STORAGE_STATE_JSON` (inline) or `config.path` (file) |
| `form-login` | `APP_USERNAME`, `APP_PASSWORD` (configurable via `usernameEnv`/`passwordEnv`) |
| `totp` | `APP_USERNAME`, `APP_PASSWORD`, `TOTP_SECRET` |
| `oauth-client-credentials` | `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` |
| `vault-oidc` | `VAULT_APP_USERNAME`, `VAULT_APP_PASSWORD`, optional `VAULT_APP_USERNAME_PREV`, `VAULT_APP_PASSWORD_PREV` (dual-credential fallback) |

### Network profiles (synthetic-kit)

| Profile | Config / env |
|---|---|
| `direct` | — |
| `proxy` | `config.server`, `config.username`, `config.password` |
| `mtls` | `MTLS_CERT_BASE64`, `MTLS_KEY_BASE64` (PEM, base64-encoded), plus `config.origin` |
| `tailscale` / `wireguard` | The tunnel is established at the workflow level — Playwright just uses the routed network |

## GitHub Action inputs → env var mapping

When you call the composite `action.yml` with specific inputs,
they're translated to env vars for the dispatcher:

| Action input | Env var |
|---|---|
| `api_url` | `INSIGHTVIEW_API_URL` |
| `api_token` | `INSIGHTVIEW_API_TOKEN` |
| `check_name` | `INSIGHTVIEW_CHECK_NAME` |
| `monitors_path` | `INSIGHTVIEW_MONITORS_PATH` |
| `wait` | `INSIGHTVIEW_WAIT` |
| `heartbeat_url` | `INSIGHTVIEW_HEARTBEAT_URL` |
| `artifacts_dir` | `INSIGHTVIEW_ARTIFACTS_DIR` |

The `status` command additionally reads
`INSIGHTVIEW_FAIL_ON_DEGRADE=true` as a shorthand for the
`--fail-on-degrade` flag so you can set it via workflow env.

## Mobile RUM SDK (`@insightview/rum-mobile`)

The mobile SDK takes its configuration via `init(opts)` at
runtime — there are no env vars. `opts.endpoint` points at
either the rum-collector or the Cloudflare Worker edge proxy.

## Cloudflare Worker edge collector

`infra/cloudflare-worker/wrangler.toml` reads:

| Variable | Purpose |
|---|---|
| `UPSTREAM_URL` | The origin collector's `/v1/events` URL |
| `UPSTREAM_REPLAY_URL` | The origin collector's `/v1/replay` URL |
| `RATE_LIMIT_PER_MINUTE` | Per-client rate cap |

Set via `wrangler secret put UPSTREAM_URL` at deploy time.

## Helm chart values

See `infra/helm/insightview/values.yaml` for the full
reference. Key values:

| Path | Default | Purpose |
|---|---|---|
| `database.url` | — | Required — points at managed Postgres |
| `eventBus.backend` | `bullmq` | `bullmq` or `kafka` |
| `eventBus.redisUrl` | `redis://redis:6379` | BullMQ mode |
| `eventBus.kafkaBrokers` | `kafka:9092` | Kafka mode |
| `otel.enabled` | `false` | Enable OTLP export |
| `otel.exporterEndpoint` | `http://otel-collector:4318/v1/traces` | OTLP/HTTP endpoint |
| `apiToken` | — | Static Bearer token (stored as a K8s secret) |
| `runner.replicas` | `3` | Horizontal runner scale |

## Terraform module inputs

`infra/terraform/modules/monitor/main.tf` reads:

| Variable | Purpose |
|---|---|
| `api_url` | Platform API URL |
| `api_token` | Admin-scoped API token (Terraform writes to `/v1/monitors/apply`) |
| `name`, `schedule`, `target_url`, `assertions`, ... | Monitor fields |

---

## Legacy v1 secrets (command: legacy-run)

This section is preserved verbatim for v1.x users still running
the Playwright fixture path via `command: legacy-run`. The
platform and Actions-native modes do not need these secrets.

### Base Configuration

- `PROMETHEUS_PUSHGATEWAY` - URL to your Prometheus Pushgateway
- `TEST_URL` - Default URL to test

### AWS S3

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`

### MinIO

- `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` **or**
  `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
- `MINIO_ENDPOINT`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`,
  `S3_TLS_VERIFY`

Credential priority order (applies to all modes):

1. `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`
2. `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
3. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
4. Default fallback: `minioadmin` / `minioadmin`

### Troubleshooting

- **S3 export disabled** — ensure `S3_BUCKET` and either
  `S3_ENDPOINT` or `MINIO_ENDPOINT` are set.
- **Connection errors** — check that endpoint URLs are
  reachable from the runner.
- **TLS errors** — for self-signed certificates, set
  `S3_TLS_VERIFY=false`.
