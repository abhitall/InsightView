# Operations guide

Production deploy recipes for the InsightView platform. Covers
the three supported paths: **docker-compose** (single host),
**Helm** (Kubernetes), **ARC + Actions-native** (zero-
infrastructure monitoring), plus the event-bus backend switch,
OTel wiring, and Terraform monitors-as-code.

For environment variable reference, see
[`SECRETS_CONFIGURATION.md`](SECRETS_CONFIGURATION.md).
For architecture, see [`ARCHITECTURE.md`](ARCHITECTURE.md).
For the decisions behind the topology, see the ADR index at
[`adr/`](adr/).

## 1. Single-host docker-compose (default)

The simplest path. `pnpm compose:up` brings up Postgres, Redis,
MinIO, Prometheus, Pushgateway, the API, scheduler, runner,
alerting, rum-collector, dashboard, and a test site on one
Docker host with BullMQ as the event bus.

```bash
pnpm install
pnpm compose:up
pnpm e2e:test          # end-to-end smoke against the running stack
pnpm compose:logs      # follow logs
pnpm compose:down      # teardown
```

Exposed ports:

| Service | URL |
|---|---|
| Dashboard | http://localhost:5173 |
| API | http://localhost:4000 |
| Public status page | http://localhost:4000/v1/status/ |
| RUM collector | http://localhost:4400 |
| Test site | http://localhost:8080 |
| Prometheus | http://localhost:9090 |
| Pushgateway | http://localhost:9091 |
| MinIO console | http://localhost:9001 |

## 2. Switching the event bus to Kafka

Kafka is opt-in via a compose profile so the default boot stays
fast. See [ADR 0010](adr/0010-kafka-event-bus.md) for the design.

```bash
# Boot the Bitnami Kafka broker (KRaft mode, no ZooKeeper):
docker compose -f infra/docker-compose.yml --profile kafka up -d kafka

# Boot the rest of the stack with BUS_BACKEND=kafka pointed at it:
BUS_BACKEND=kafka KAFKA_BROKERS=kafka:9092 pnpm compose:up
```

Once Kafka is selected:

- The factory in `packages/event-bus/src/factory.ts` auto-picks
  `KafkaEventBus` + `KafkaScheduler` instead of the BullMQ
  versions. No application code changes.
- The **transactional outbox** kicks in. The scheduler's
  `OutboxPublisher` loop reads unpublished `DomainEvent` rows
  and ships them to Kafka with at-least-once delivery.
- **Cron scheduling** runs in-process via `node-cron` (instead
  of BullMQ repeatable jobs). The leader-elected scheduler
  reconciles schedules from Postgres every 15 seconds so a
  leader failover re-installs cron expressions within one tick.
- Topics are auto-created on first publish with 12 partitions
  so per-key ordering has horizontal room to scale without
  repartitioning.

### Kafka topic topology

| Topic | Produced by | Consumed by |
|---|---|---|
| `checks.scheduled` | scheduler | runner (consumer group `insightview-runner`) |
| `checks.started` | runner | dashboard (optional) |
| `checks.completed` | runner | alerting (consumer group `insightview-alerting`) |
| `alerts.triggered` | alerting | dispatcher → notification channels |
| `alerts.resolved` | alerting | dispatcher |
| `rum.events.ingested` | rum-collector (fire-and-forget) | — |

### Reverting to BullMQ

```bash
unset BUS_BACKEND KAFKA_BROKERS
pnpm compose:down
pnpm compose:up
```

BullMQ is fully functional as a production backend for small-
to-medium deployments — the Kafka switch is a scale decision,
not a correctness decision.

## 3. Kubernetes via Helm

The chart lives at `infra/helm/insightview/` and covers the
five core services plus a shared env-var helper. **It does
NOT deploy Postgres, Redis, or Kafka themselves** — point at
managed instances or bring-your-own.

```bash
# 1. Prepare namespace and API-token secret
kubectl create namespace insightview
kubectl -n insightview create secret generic insightview-auth \
  --from-literal=apiToken=$(openssl rand -hex 32)

# 2. Install
helm install insightview ./infra/helm/insightview \
  --namespace insightview \
  --set database.url=postgres://user:pw@managed-postgres:5432/insightview \
  --set eventBus.backend=kafka \
  --set eventBus.kafkaBrokers=kafka-0:9092,kafka-1:9092,kafka-2:9092 \
  --set otel.enabled=true \
  --set otel.exporterEndpoint=http://otel-collector:4318/v1/traces \
  --set apiToken=<paste the token from step 1>

# 3. Watch the rollout
kubectl -n insightview get pods -w
```

Scale recommendations:

| Service | Purpose | `replicas` |
|---|---|---|
| `api` | REST + ingest | 2 (behind an ingress + HPA on CPU) |
| `scheduler` | Leader-elected cron + outbox publisher | 2 (only the leader does work) |
| `runner` | Playwright executor — horizontal | 3+ (HPA on Kafka consumer lag) |
| `alerting` | Strategy evaluator | 2 |
| `rum-collector` | Beacon intake — horizontal | 3+ (HPA on RPS) |
| `dashboard` | Static SPA | 2 |

The chart's `values.yaml` exposes everything via
`--set` flags; see
[`SECRETS_CONFIGURATION.md`](SECRETS_CONFIGURATION.md) for the
full reference.

### Upgrading

Helm upgrades are safe as long as the Prisma schema migration
runs successfully before the new API pods roll out. The chart
does not ship a migration Job today — run
`pnpm --filter @insightview/db run migrate` from a bastion
against your managed Postgres before bumping the `image.tag`.

## 4. Multi-region Actions-native runners via ARC

For teams that want **zero central infrastructure** but still
need geographic distribution, the Actions Runner Controller
manifests deploy three regional scale sets.

```bash
# 1. Install ARC controller (one-time, cluster-scoped)
helm repo add actions-runner-controller \
  https://actions-runner-controller.github.io/actions-runner-controller
helm install arc actions-runner-controller/gha-runner-scale-set-controller \
  --namespace arc-systems --create-namespace

# 2. Create the GitHub token secret (scoped to InsightView org/repo)
kubectl create secret generic insightview-gh-token \
  --namespace insightview-arc \
  --from-literal=github_token=ghp_xxxxxxxxxxxx

# 3. Apply the scale sets
kubectl apply -f infra/k8s/actions-runner-controller/namespace.yaml
kubectl apply -f infra/k8s/actions-runner-controller/runner-scale-set.yaml
```

Workflows target regions with `runs-on` matrices:

```yaml
jobs:
  monitor:
    strategy:
      matrix:
        region: [us-east, eu-west, ap-southeast]
    runs-on: [self-hosted, insightview, "${{ matrix.region }}"]
    container:
      image: mcr.microsoft.com/playwright:v1.51.0-noble
    steps:
      - uses: actions/checkout@v4
      - uses: ./
        with:
          command: native-run
          monitors_path: monitors
```

Every run fires three parallel jobs — one per region — and
each run's `ResultEnvelope.location` field records which
region emitted it.

## 5. Terraform monitors-as-code

For teams already on Terraform, the HCL modules at
`infra/terraform/modules/` wrap the platform API so your
monitors live alongside the rest of your infrastructure.

```hcl
terraform {
  required_providers {
    http = { source = "hashicorp/http", version = "~> 3.4" }
  }
}

variable "api_token" {
  type      = string
  sensitive = true
}

module "homepage" {
  source = "github.com/abhitall/insightview//infra/terraform/modules/monitor?ref=main"

  api_url    = "https://api.insightview.example.com"
  api_token  = var.api_token

  name        = "homepage"
  schedule    = "*/5 * * * *"
  target_url  = "https://example.com/"
  timeout_ms  = 45000
  assertions  = [
    { type = "status",          value = "passed" },
    { type = "title-contains",  value = "Example Domain" },
    { type = "max-lcp-ms",      value = "2500" },
    { type = "max-cls",         value = "0.1" },
  ]
  tags = ["production", "critical"]
}

module "homepage_anomaly" {
  source = "github.com/abhitall/insightview//infra/terraform/modules/alert-rule?ref=main"

  api_url    = "https://api.insightview.example.com"
  api_token  = var.api_token

  name       = "homepage-lcp-anomaly"
  check_name = module.homepage.name
  strategy   = "ANOMALY_DETECTION"
  expression = {
    metric    = "LCP"
    threshold = 3.0
    window    = 20
    direction = "higher"
  }
  severity = "WARNING"
  channels = ["stdout", "slack"]
}
```

The modules use the `http` provider's `http` data source to
POST to `/v1/monitors/apply`, which upserts by `(tenant, name)`
— applying is idempotent and `terraform destroy` is a no-op
(the upstream ADR 0012 role-guard prevents accidental mass-
delete). Deletions are explicit: disable the monitor via
`enabled = false` and re-apply, or delete via the REST API.

## 6. Managing API tokens

For teams using the issued-token path instead of a shared
`API_TOKEN`, mint tokens via the admin route:

```bash
# Mint a write-scoped token for your CI system
curl -X POST https://api.insightview.example.com/v1/tokens \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ci-deploy",
    "role": "write",
    "scopes": ["monitors:deploy", "runs:trigger"],
    "expiresInDays": 30
  }'

# Response: { "id": "...", "raw": "iv_...", ... }
# Store the `raw` value immediately — it is only returned once.

# List all tokens (hash is never returned)
curl https://api.insightview.example.com/v1/tokens \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Revoke
curl -X DELETE https://api.insightview.example.com/v1/tokens/<id> \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Every mint and revoke writes an `AuditLog` row queryable via
`GET /v1/audit?resource=ApiToken&limit=50` (requires `write`
role or above).

## 7. Enabling OpenTelemetry

```bash
# Any service, any deployment mode:
export OTEL_EXPORTER_OTLP_ENDPOINT=https://tempo.example.com/v1/traces
export OTEL_SERVICE_NAME=insightview-api   # optional override
```

When the endpoint is set, every service's spans batch-export
via OTLP/HTTP. The synthetic-kit **injects W3C `traceparent`
headers** into every Playwright navigation via
`context.setExtraHTTPHeaders` so the target's OTel-
instrumented backend continues the same distributed trace.

When the endpoint is unset, tracing stays active in-process —
spans still exist and `traceparent` still propagates through
the event bus envelope — the export is just a no-op. This
means you can flip on OTel in production without forcing
every developer to run a collector locally.

Span flow in a synthetic run:

```
synthetic-kit runCheck (root span)
  ├── playwright navigation (child, injects traceparent)
  │     └── customer backend span (continued by their OTel agent)
  │             └── DB query span (...)
  ├── web-vitals collection
  ├── assertions
  └── exporters (pushgateway, s3, platform)
```

See [ADR 0012](adr/0012-auth-rbac-otel.md) for the full
propagation design.

## 8. Backups and retention

- **Postgres** — standard managed-instance snapshots. Retention
  of operational data (`CheckResult`, `RumEvent`, `AuditLog`)
  is your decision today — a ClickHouse migration is planned
  (explicitly out of scope for this iteration).
- **MinIO / S3 artifacts** — lifecycle rules on the bucket are
  the right tool. 30 days for screenshots, 7 days for traces
  is a reasonable starting point.
- **Outbox retention** — the `OutboxPublisher` reaps
  `DomainEvent` rows older than 7 days by default (change via
  `OutboxPublisherOpts.retentionMs`).
- **Audit log** — append-only, no default retention. Redaction
  is a manual DBA task.
- **Kafka topics** — set `retention.ms` per topic per your
  storage budget. For replay use cases 7 days is a reasonable
  default.

## 9. Observability dashboard install

Grafana dashboards live at `infra/grafana/dashboards/`. Import
via the Grafana UI (Dashboards → New → Import → Upload) or via
provisioning:

```yaml
# /etc/grafana/provisioning/dashboards/insightview.yaml
apiVersion: 1
providers:
  - name: insightview
    folder: InsightView
    type: file
    options:
      path: /var/lib/grafana/dashboards/insightview
```

Then mount `infra/grafana/dashboards/` at
`/var/lib/grafana/dashboards/insightview/`. The `rum.json`
dashboard includes the **synthetic vs RUM LCP overlay panel** —
the single most useful view for distinguishing "your site is
slow" from "your edge is slow".

## 10. Health and readiness

Every service exposes:

- `GET /healthz` — liveness, returns 200 whenever the process is
  up. Safe for Kubernetes liveness probes.
- `GET /readyz` — readiness, returns 200 only when the service
  can serve traffic (DB reachable, etc.). Use for readiness
  probes and ingress health checks.
- `GET /metrics` — Prometheus scrape endpoint.
- `GET /v1/status.json` — aggregate platform status, suitable
  for status-page integration.
- `GET /v1/status/` — unauthenticated HTML status page.
