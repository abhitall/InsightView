# GitHub Secrets Configuration

This document explains how to configure GitHub repository secrets for the Synthetic Monitoring action.

## Required Secrets

### Base Configuration
- `PROMETHEUS_PUSHGATEWAY` - URL to your Prometheus Pushgateway (e.g., `http://prometheus-gateway.example.com:9091`)
- `TEST_URL` - Default URL to test (can be overridden in workflow dispatch)

## S3 Storage Configuration (Optional)

The action supports both AWS S3 and S3-compatible services like MinIO. If you don't configure S3 storage, metrics will only be sent to Prometheus.

### Option 1: AWS S3
For AWS S3 buckets, configure these secrets:

- `AWS_ACCESS_KEY_ID` - Your AWS access key
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key  
- `AWS_REGION` - AWS region where your bucket is located (e.g., `us-east-1`)
- `S3_BUCKET` - Name of your S3 bucket

### Option 2: MinIO or S3-Compatible Services
For MinIO or other S3-compatible services, configure these secrets:

#### MinIO Credentials (choose one set):
**Option A: MinIO Access Keys**
- `MINIO_ACCESS_KEY` - MinIO access key
- `MINIO_SECRET_KEY` - MinIO secret key

**Option B: MinIO Root Credentials**
- `MINIO_ROOT_USER` - MinIO root username
- `MINIO_ROOT_PASSWORD` - MinIO root password

#### MinIO Configuration:
- `MINIO_ENDPOINT` - MinIO server URL (e.g., `https://minio.example.com`)
- `S3_BUCKET` - Name of your MinIO bucket
- `S3_FORCE_PATH_STYLE` - Set to `true` for MinIO (optional, defaults to `true`)
- `S3_TLS_VERIFY` - Set to `false` for self-signed certificates (optional, defaults to `true`)

### Option 3: Custom S3-Compatible Service
For other S3-compatible services:

- `AWS_ACCESS_KEY_ID` - Access key for your service
- `AWS_SECRET_ACCESS_KEY` - Secret key for your service
- `AWS_REGION` - Region (can be any value for non-AWS services)
- `S3_ENDPOINT` - URL to your S3-compatible service
- `S3_BUCKET` - Bucket name
- `S3_FORCE_PATH_STYLE` - Set to `true` if needed
- `S3_TLS_VERIFY` - Set to `false` for self-signed certificates

## Setting Secrets in GitHub

1. Navigate to your repository on GitHub
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret with the exact name from the lists above
5. Save each secret

## Environment Variable Priority

The action uses the following priority for credentials:

1. `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`
2. `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`  
3. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
4. Default fallback: `minioadmin` / `minioadmin`

For endpoints:
1. `S3_ENDPOINT`
2. `MINIO_ENDPOINT`

## Example Configurations

### AWS S3 Example
```
PROMETHEUS_PUSHGATEWAY=https://prometheus.example.com:9091
TEST_URL=https://myapp.example.com
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=abc123...
AWS_REGION=us-east-1
S3_BUCKET=my-monitoring-bucket
```

### MinIO Example
```
PROMETHEUS_PUSHGATEWAY=https://prometheus.example.com:9091
TEST_URL=https://myapp.example.com
MINIO_ENDPOINT=https://minio.example.com
MINIO_ACCESS_KEY=monitoring-user
MINIO_SECRET_KEY=secure-password-123
S3_BUCKET=synthetic-monitoring
S3_FORCE_PATH_STYLE=true
S3_TLS_VERIFY=false
```

### Prometheus Only (No S3)
```
PROMETHEUS_PUSHGATEWAY=https://prometheus.example.com:9091
TEST_URL=https://myapp.example.com
```

## Troubleshooting

- **S3 export disabled**: If you see "S3 export disabled" in logs, ensure you have configured at minimum `S3_BUCKET` and either `S3_ENDPOINT` or `MINIO_ENDPOINT`
- **Connection errors**: Check that your endpoint URLs are correct and accessible from GitHub Actions runners
- **Permission errors**: Ensure your credentials have read/write access to the specified bucket
- **TLS errors**: For self-signed certificates, set `S3_TLS_VERIFY=false`