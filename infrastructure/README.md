# Infrastructure Setup

This guide explains how to set up the required infrastructure for synthetic monitoring.

## Prerequisites

- Docker and Docker Compose
- AWS Account (or MinIO for local development)
- Kubernetes cluster (optional)

## Local Development Setup

1. Create a `.env` file:

```bash
cp .env.example .env
```

2. Start the local infrastructure:

```bash
docker-compose -f infrastructure/docker-compose.yml up -d
```

This will start:
- MinIO (S3-compatible storage)
- Prometheus
- Prometheus Pushgateway
- Grafana

## Production Setup

### MinIO Setup

1. Deploy MinIO:

```bash
kubectl apply -f infrastructure/k8s/minio/
```

2. Create a bucket:

```bash
mc mb minio/synthetic-monitoring
```

### Prometheus Setup

1. Install Prometheus Operator:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install prometheus prometheus-community/kube-prometheus-stack
```

2. Deploy Pushgateway:

```bash
kubectl apply -f infrastructure/k8s/prometheus/pushgateway.yaml
```

3. Configure Prometheus rules:

```bash
kubectl apply -f infrastructure/k8s/prometheus/rules.yaml
```

### Grafana Setup

1. Import dashboards:

```bash
kubectl apply -f infrastructure/k8s/grafana/dashboards/
```

2. Configure data sources:

```bash
kubectl apply -f infrastructure/k8s/grafana/datasources/
```

## Environment Variables

Set the following environment variables:

```bash
# S3/MinIO
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=your_region
S3_BUCKET=synthetic-monitoring

# Prometheus
PROMETHEUS_PUSHGATEWAY=http://pushgateway:9091
```

## Dashboards

The following Grafana dashboards are available:

1. Web Vitals Overview
2. Test Execution Metrics
3. Resource Usage
4. Error Analysis