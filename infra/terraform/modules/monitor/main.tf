terraform {
  required_version = ">= 1.4.0"
  required_providers {
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
  }
}

variable "api_url" {
  description = "Base URL of the InsightView platform API"
  type        = string
}

variable "api_token" {
  description = "Bearer token for the platform API"
  type        = string
  sensitive   = true
}

variable "name" {
  description = "Monitor name (unique within tenant)"
  type        = string
}

variable "description" {
  description = "Optional human description"
  type        = string
  default     = null
}

variable "type" {
  description = "Check type"
  type        = string
  default     = "browser"
  validation {
    condition     = contains(["browser", "api", "tcp"], var.type)
    error_message = "type must be browser, api, or tcp"
  }
}

variable "schedule" {
  description = "Cron schedule expression"
  type        = string
}

variable "target_url" {
  description = "URL to monitor"
  type        = string
}

variable "timeout_ms" {
  description = "Per-run timeout in milliseconds"
  type        = number
  default     = 45000
}

variable "assertions" {
  description = "List of { type, value } assertions"
  type = list(object({
    type  = string
    value = string
  }))
  default = []
}

variable "tags" {
  description = "Tags for grouping in dashboards / alerts"
  type        = list(string)
  default     = []
}

locals {
  monitor_yaml = yamlencode({
    apiVersion = "insightview.io/v1"
    kind       = "Check"
    metadata = {
      name        = var.name
      description = var.description
      tags        = var.tags
    }
    spec = {
      type       = var.type
      schedule   = var.schedule
      targetUrl  = var.target_url
      timeoutMs  = var.timeout_ms
      assertions = var.assertions
    }
  })
}

# The InsightView API upserts by (tenantId, name) so re-applying
# is idempotent. We POST the YAML under a stable URL that never
# changes so Terraform treats it as a managed resource.
data "http" "apply" {
  url    = "${var.api_url}/v1/monitors/apply"
  method = "POST"
  request_headers = {
    Content-Type  = "application/json"
    Authorization = "Bearer ${var.api_token}"
  }
  request_body = jsonencode({
    yaml   = local.monitor_yaml
    actor  = "terraform"
    source = "CLI"
  })
  lifecycle {
    postcondition {
      condition     = self.status_code >= 200 && self.status_code < 300
      error_message = "InsightView apply failed with HTTP ${self.status_code}: ${self.response_body}"
    }
  }
}

output "name" {
  description = "The monitor name (echoes var.name for easy interpolation)"
  value       = var.name
}

output "deployment_response" {
  description = "Raw API response from the platform"
  value       = data.http.apply.response_body
}
