# InsightView Terraform modules

HCL modules that manage InsightView monitors-as-code via the
platform REST API. Gives Terraform users a native way to define
checks, alert rules, notification channels, and API tokens
alongside the rest of their infrastructure — the same YAML that
`command: deploy` accepts is generated under the hood.

## Usage

```hcl
terraform {
  required_providers {
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
  }
}

module "insightview_homepage" {
  source = "./modules/monitor"

  api_url   = var.insightview_api_url
  api_token = var.insightview_api_token

  name        = "homepage"
  target_url  = "https://example.com/"
  schedule    = "*/5 * * * *"
  timeout_ms  = 45000
  assertions  = [
    { type = "status",          value = "passed" },
    { type = "max-lcp-ms",      value = "2500" },
    { type = "title-contains",  value = "Example Domain" },
  ]
  tags = ["production", "critical"]
}

module "homepage_alert" {
  source = "./modules/alert-rule"

  api_url    = var.insightview_api_url
  api_token  = var.insightview_api_token

  name       = "homepage-down"
  check_name = module.insightview_homepage.name
  strategy   = "CONSECUTIVE_FAILURES"
  expression = { threshold = 2 }
  severity   = "CRITICAL"
  channels   = ["stdout", "pagerduty"]
}
```

## Modules

- `modules/monitor`     — creates / updates a Check
- `modules/alert-rule`  — creates / updates an AlertRule
- `modules/channel`     — creates / updates a NotificationChannel

Each module uses the `http` provider's `http` data source to
POST the equivalent YAML to `/v1/monitors/apply`. Because the
platform upserts by `(tenantId, name)`, applying is idempotent
and `terraform destroy` revokes by posting a disabled version of
the same monitor.

## Why HCL modules, not a Terraform provider

A proper provider (written in Go) gives you stronger typing and
`terraform plan` diffs but requires a Go toolchain, a release
pipeline, and a lot of boilerplate. HCL modules backed by the
`http` provider deliver 95% of the user value with zero publishing
overhead and work with any Terraform version from 1.4 onward.

A Go-based provider is Phase 5 work.
