# Synthetic Monitoring GitHub Action

A GitHub Action for running synthetic monitoring tests using Playwright, with built-in support for metrics collection and reporting.

## Features

- Web Vitals metrics collection (CLS, FCP, FID, INP, LCP, TTFB)
- Prometheus metrics integration
- S3 trace storage
- Configurable test paths and browsers
- Support for custom environment variables
- Automated scheduling with manual trigger option

## Usage

```yaml
- uses: your-org/synthetic-monitoring@v1
  with:
    test_url: 'https://example.com'
    aws_access_key_id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws_secret_access_key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws_region: ${{ secrets.AWS_REGION }}
    s3_bucket: ${{ secrets.S3_BUCKET }}
    prometheus_pushgateway: ${{ secrets.PROMETHEUS_PUSHGATEWAY }}
    browser: 'chromium'
    config_path: './playwright.config.ts'
    test_dir: './tests'
    env_vars: '{"AUTH_TOKEN": "${{ secrets.AUTH_TOKEN }}"}'
```

## Local Development

### Prerequisites

1. Install [nektos/act](https://github.com/nektos/act)
2. Install Docker
3. Node.js 20 or later

### Testing Locally

1. Start the test infrastructure:
```bash
npm run docker:test:up
```

2. Run the action locally:
```bash
npm run test:action
```

3. Clean up:
```bash
npm run docker:test:down
```

## Inputs

| Name | Description | Required | Default |
|------|-------------|----------|---------|
| test_url | Target URL to test | Yes | - |
| aws_access_key_id | AWS Access Key ID | Yes | - |
| aws_secret_access_key | AWS Secret Access Key | Yes | - |
| aws_region | AWS Region | Yes | - |
| s3_bucket | S3 Bucket name | Yes | - |
| prometheus_pushgateway | Prometheus Pushgateway URL | Yes | - |
| browser | Browser to use for testing | No | chromium |
| config_path | Path to Playwright config file | No | - |
| test_dir | Directory containing test files | No | - |
| env_vars | JSON string of additional environment variables | No | {} |

## Example Test

```typescript
import { test } from '../src/monitoring';
import { expect } from '@playwright/test';

test('homepage performance test', async ({ page, monitoring }) => {
  await test.step('Navigate to homepage', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });
  
  await test.step('Verify page title', async () => {
    await expect(page).toHaveTitle(/Expected Title/);
  });
  
  await test.step('Collect monitoring data', async () => {
    await monitoring();
  });
});
```

## Project Structure

```
├── src/
│   ├── types/           # TypeScript type definitions
│   ├── collectors/      # Metric collection modules
│   │   ├── webVitals.ts
│   │   └── testMetrics.ts
│   ├── exporters/       # Metric export modules
│   │   ├── prometheus.ts
│   │   └── s3.ts
│   └── monitoring.ts    # Main monitoring module
├── tests/              # Example tests
└── .github/
    └── actions/
        └── synthetic-monitoring/  # GitHub Action
```

## License

MIT