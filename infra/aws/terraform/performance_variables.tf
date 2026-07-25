variable "rds_connection_alarm_threshold" {
  description = "Maximum RDS connections before capacity pressure is alerted. Keep below the instance max_connections reserve."
  type        = number
  default     = 80

  validation {
    condition     = var.rds_connection_alarm_threshold >= 1
    error_message = "rds_connection_alarm_threshold must be at least 1."
  }
}
