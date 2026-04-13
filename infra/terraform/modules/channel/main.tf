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
variable "type" {
  type = string
  validation {
    condition = contains(
      ["SLACK_WEBHOOK", "GENERIC_WEBHOOK", "STDOUT"],
      var.type,
    )
    error_message = "type must be SLACK_WEBHOOK, GENERIC_WEBHOOK, or STDOUT"
  }
}
variable "config" {
  type      = map(any)
  default   = {}
  sensitive = true
}

data "http" "apply" {
  url    = "${var.api_url}/v1/channels"
  method = "POST"
  request_headers = {
    Content-Type  = "application/json"
    Authorization = "Bearer ${var.api_token}"
  }
  request_body = jsonencode({
    name   = var.name
    type   = var.type
    config = var.config
  })
  lifecycle {
    postcondition {
      condition     = self.status_code >= 200 && self.status_code < 300
      error_message = "InsightView channel apply failed: ${self.status_code} ${self.response_body}"
    }
  }
}

output "name" {
  value = var.name
}
