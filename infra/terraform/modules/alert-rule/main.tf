terraform {
  required_version = ">= 1.4.0"
  required_providers {
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
  }
}

variable "api_url" { type = string }
variable "api_token" {
  type      = string
  sensitive = true
}
variable "name" { type = string }
variable "check_name" {
  type    = string
  default = null
}
variable "strategy" {
  type = string
  validation {
    condition = contains(
      ["THRESHOLD", "CONSECUTIVE_FAILURES", "COMPOSITE", "ANOMALY_DETECTION", "RUM_METRIC"],
      var.strategy,
    )
    error_message = "strategy must be one of the registered alert strategies"
  }
}
variable "expression" { type = map(any) }
variable "severity" {
  type = string
  validation {
    condition     = contains(["INFO", "WARNING", "CRITICAL"], var.severity)
    error_message = "severity must be INFO, WARNING, or CRITICAL"
  }
}
variable "channels" {
  type    = list(string)
  default = ["stdout"]
}
variable "cooldown_seconds" {
  type    = number
  default = 300
}

locals {
  rule_yaml = yamlencode({
    apiVersion = "insightview.io/v1"
    kind       = "AlertRule"
    metadata = {
      name = var.name
    }
    spec = {
      checkName       = var.check_name
      strategy        = var.strategy
      expression      = var.expression
      severity        = var.severity
      cooldownSeconds = var.cooldown_seconds
      channels        = var.channels
    }
  })
}

data "http" "apply" {
  url    = "${var.api_url}/v1/monitors/apply"
  method = "POST"
  request_headers = {
    Content-Type  = "application/json"
    Authorization = "Bearer ${var.api_token}"
  }
  request_body = jsonencode({
    yaml   = local.rule_yaml
    actor  = "terraform"
    source = "CLI"
  })
  lifecycle {
    postcondition {
      condition     = self.status_code >= 200 && self.status_code < 300
      error_message = "InsightView alert rule apply failed: ${self.status_code} ${self.response_body}"
    }
  }
}

output "name" {
  value = var.name
}
