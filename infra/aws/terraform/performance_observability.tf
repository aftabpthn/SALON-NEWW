resource "aws_cloudwatch_metric_alarm" "alb_p95_latency" {
  alarm_name          = "${local.name}-alb-p95-latency"
  alarm_description   = "API target p95 latency is above the two-second report budget."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 2
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    LoadBalancer = aws_lb.api.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${local.name}-rds-connections"
  alarm_description   = "PostgreSQL connections are approaching the reserved capacity limit."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = var.rds_connection_alarm_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "redis_cache_hit_rate" {
  alarm_name          = "${local.name}-redis-cache-hit-rate"
  alarm_description   = "Redis cache hit rate is below 70 percent for sustained traffic."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 70
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  metric_query {
    id          = "hit_rate"
    expression  = "IF((hits + misses) > 0, 100 * hits / (hits + misses), 100)"
    label       = "Redis cache hit percent"
    return_data = true
  }

  metric_query {
    id          = "hits"
    return_data = false
    metric {
      namespace   = "AWS/ElastiCache"
      metric_name = "CacheHits"
      period      = 300
      stat        = "Sum"
      dimensions = {
        ReplicationGroupId = aws_elasticache_replication_group.redis.replication_group_id
      }
    }
  }

  metric_query {
    id          = "misses"
    return_data = false
    metric {
      namespace   = "AWS/ElastiCache"
      metric_name = "CacheMisses"
      period      = 300
      stat        = "Sum"
      dimensions = {
        ReplicationGroupId = aws_elasticache_replication_group.redis.replication_group_id
      }
    }
  }
}

resource "aws_cloudwatch_dashboard" "performance" {
  dashboard_name = "${local.name}-performance"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "ALB latency and target errors"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.api.arn_suffix, "TargetGroup", aws_lb_target_group.api.arn_suffix, { stat = "p95", label = "Target p95 seconds" }],
            [".", "HTTPCode_Target_5XX_Count", ".", ".", ".", ".", { stat = "Sum", label = "Target 5xx" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "RDS saturation and latency"
          region = var.aws_region
          period = 60
          metrics = [
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", aws_db_instance.postgres.identifier, { stat = "Maximum" }],
            [".", "CPUUtilization", ".", ".", { stat = "Average", yAxis = "right" }],
            [".", "ReadLatency", ".", ".", { stat = "Average" }],
            [".", "WriteLatency", ".", ".", { stat = "Average" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 24
        height = 6
        properties = {
          title  = "Redis hit rate, connections, and evictions"
          region = var.aws_region
          period = 300
          metrics = [
            [{ expression = "IF((hits + misses) > 0, 100 * hits / (hits + misses), 100)", label = "Cache hit percent", id = "hit_rate" }],
            ["AWS/ElastiCache", "CacheHits", "ReplicationGroupId", aws_elasticache_replication_group.redis.replication_group_id, { stat = "Sum", id = "hits", visible = false }],
            [".", "CacheMisses", ".", ".", { stat = "Sum", id = "misses", visible = false }],
            [".", "CurrConnections", ".", ".", { stat = "Maximum", yAxis = "right" }],
            [".", "Evictions", ".", ".", { stat = "Sum", yAxis = "right" }],
          ]
        }
      },
    ]
  })
}
