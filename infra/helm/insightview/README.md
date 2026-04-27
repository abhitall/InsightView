# InsightView Helm chart

Deploys the InsightView monitoring platform to Kubernetes. Does
**not** deploy Postgres, Redis, or Kafka itself — point at
managed instances or bring-your-own.

## Install

```bash
# 1. Create a namespace and a secret with the API token:
kubectl create namespace insightview
kubectl -n insightview create secret generic insightview-auth \
  --from-literal=apiToken=$(openssl rand -hex 32)

# 2. Install the chart:
helm install insightview ./infra/helm/insightview \
  --namespace insightview \
  --set database.url=postgres://user:pw@managed-postgres:5432/insightview \
  --set eventBus.backend=kafka \
  --set eventBus.kafkaBrokers=kafka-0:9092,kafka-1:9092 \
  --set otel.enabled=true \
  --set otel.exporterEndpoint=http://otel-collector:4318/v1/traces
```

## Values

| Key                         | Default                    | Purpose |
|-----------------------------|----------------------------|---------|
| `image.repository`          | `ghcr.io/abhitall/insightview` | Base image |
| `image.tag`                 | `latest`                   | Service image tag |
| `database.url`              | —                          | Postgres connection URL |
| `eventBus.backend`          | `bullmq`                   | `bullmq` or `kafka` |
| `eventBus.redisUrl`         | `redis://redis:6379`       | Redis for BullMQ mode |
| `eventBus.kafkaBrokers`     | `kafka:9092`               | Kafka brokers for Kafka mode |
| `otel.enabled`              | `false`                    | Enable OTLP trace export |
| `otel.exporterEndpoint`     | `http://otel-collector:4318/v1/traces` | OTLP/HTTP endpoint |
| `apiToken`                  | —                          | Shared secret bearer token |
| `api.replicas`              | `2`                        | API replica count |
| `scheduler.replicas`        | `2`                        | Scheduler replicas (1 leader) |
| `runner.replicas`           | `3`                        | Synthetic runners (horizontal scale) |
| `alerting.replicas`         | `2`                        | Alerting workers |
| `rumCollector.replicas`     | `3`                        | RUM intake workers |

## Templates

Each service has one template under `templates/`. They share a
common helper (`_helpers.tpl`) for labels and env-var wiring so
changing a shared env var like `DATABASE_URL` is a single-file
edit.
