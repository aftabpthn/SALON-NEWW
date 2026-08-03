variable "environment" {
  description = "Isolated AuraShine environment."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "aws_region" {
  description = "AWS region for the regional application stack."
  type        = string
  default     = "ap-south-1"
}

variable "backend_image" {
  description = "Immutable ECR image URI for the Rust API."
  type        = string
}

variable "ai_image" {
  description = "Immutable ECR image URI for the private AI service."
  type        = string
}

variable "clamav_image" {
  description = "Official ClamAV feature-release image used by the private migration scanner sidecar."
  type        = string
  default     = "clamav/clamav:1.4"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "nat_gateway_count" {
  description = "Use two NAT gateways in production so each AZ has outbound redundancy."
  type        = number
  default     = 1

  validation {
    condition     = contains([1, 2], var.nat_gateway_count)
    error_message = "nat_gateway_count must be 1 or 2."
  }
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "autoscaling_min_capacity" {
  type    = number
  default = 1
}

variable "autoscaling_max_capacity" {
  type    = number
  default = 3
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 30
}

variable "db_max_allocated_storage_gb" {
  type    = number
  default = 100
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_deletion_protection" {
  type    = bool
  default = false
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "redis_node_count" {
  type    = number
  default = 1

  validation {
    condition     = var.redis_node_count >= 1 && var.redis_node_count <= 6
    error_message = "redis_node_count must be between 1 and 6."
  }
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "waf_rate_limit" {
  description = "Maximum requests from one IP during the AWS WAF evaluation window."
  type        = number
  default     = 2000
}

variable "alert_email" {
  description = "Optional email subscription for CloudWatch alarms. Confirmation is required."
  type        = string
  default     = ""
}

variable "openai_api_key" {
  description = "Optional OpenAI key for the AI sidecar. Prefer supplying it from a protected tfvars source."
  type        = string
  sensitive   = true
  default     = ""
}

variable "openai_model" {
  type    = string
  default = "gpt-5.4-mini"
}

variable "extra_cors_allowed_origins" {
  description = "Additional exact HTTPS origins besides the generated CloudFront URL."
  type        = list(string)
  default     = []
}

variable "support_email_receipt_rule_set_name" {
  description = "Existing active SES receipt rule set that will receive support email. Required when support_email_recipient_map is non-empty."
  type        = string
  default     = ""

  validation {
    condition     = length(var.support_email_recipient_map) == 0 || length(trimspace(var.support_email_receipt_rule_set_name)) > 0
    error_message = "support_email_receipt_rule_set_name is required when support_email_recipient_map is configured."
  }
}

variable "support_email_recipient_map" {
  description = "Inbound support address to authoritative tenant and branch scope. Empty disables the SES bridge."
  type = map(object({
    tenant_id = string
    branch_id = string
  }))
  default = {}

  validation {
    condition = alltrue([
      for recipient, scope in var.support_email_recipient_map :
      length(split("@", trimspace(recipient))) == 2 &&
      length(trimspace(scope.tenant_id)) > 0 &&
      length(trimspace(scope.branch_id)) > 0
    ]) && length(jsonencode(var.support_email_recipient_map)) <= 3000
    error_message = "support_email_recipient_map requires valid addresses, non-empty tenant/branch IDs, and a JSON size up to 3000 bytes."
  }
}

variable "support_email_webhook_url" {
  description = "Optional public Rust support-email webhook URL. Defaults to the generated CloudFront /api endpoint."
  type        = string
  default     = ""

  validation {
    condition     = var.support_email_webhook_url == "" || startswith(var.support_email_webhook_url, "https://")
    error_message = "support_email_webhook_url must use HTTPS."
  }
}

variable "support_email_raw_retention_days" {
  description = "Days to retain private raw MIME email for recovery and attachment audit."
  type        = number
  default     = 30

  validation {
    condition     = var.support_email_raw_retention_days >= 1 && var.support_email_raw_retention_days <= 365
    error_message = "support_email_raw_retention_days must be between 1 and 365."
  }
}

variable "error_webhook_url" {
  description = "Optional endpoint that receives 5xx incident reports (Sentry store URL, Slack webhook, or any JSON sink). Empty disables forwarding; failures still reach CloudWatch."
  type        = string
  default     = ""

  validation {
    condition     = var.error_webhook_url == "" || startswith(var.error_webhook_url, "https://")
    error_message = "error_webhook_url must use HTTPS."
  }
}
