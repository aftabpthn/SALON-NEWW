resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aurashine/${var.environment}/api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "ai" {
  name              = "/aurashine/${var.environment}/ai"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "clamav" {
  name              = "/aurashine/${var.environment}/clamav"
  retention_in_days = var.log_retention_days
}

# Receives the collector's own stdout (scrape errors, export failures).
resource "aws_cloudwatch_log_group" "otel" {
  name              = "/aurashine/${var.environment}/otel"
  retention_in_days = var.log_retention_days
}

# Receives the Embedded Metric Format documents the collector writes. Every
# scraped series lands here in full — including labels like `tenant` that are
# deliberately not promoted to CloudWatch dimensions — so Logs Insights can
# answer "which salon was slow?" without paying per-tenant metric costs.
resource "aws_cloudwatch_log_group" "metrics" {
  name              = "/aurashine/${var.environment}/metrics"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "task_execution" {
  name = "${local.name}-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name = "runtime-secrets"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
      ]
      Resource = [
        aws_secretsmanager_secret.runtime.arn,
        "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:${local.name}/restore-drill/*",
      ]
    }]
  })
}

resource "aws_iam_role" "task" {
  name = "${local.name}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "task_files" {
  name = "private-files"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = ["arn:aws:s3:::${aws_cloudformation_stack.data_protection.outputs["FileBucketName"]}"]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:PutObject",
        ]
        Resource = ["arn:aws:s3:::${aws_cloudformation_stack.data_protection.outputs["FileBucketName"]}/*"]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:GenerateDataKey",
        ]
        Resource = [aws_cloudformation_stack.data_protection.outputs["EncryptionKeyArn"]]
      },
      {
        Effect = "Allow"
        Action = [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
        ]
        Resource = [aws_efs_file_system.migration.arn]
        Condition = {
          StringEquals = {
            "elasticfilesystem:AccessPointArn" = aws_efs_access_point.migration.arn
          }
        }
      },
    ]
  })
}

resource "aws_iam_role_policy" "task_metrics" {
  name = "metrics-publishing"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:PutLogEvents",
        "logs:PutRetentionPolicy",
      ]
      # EMF reaches CloudWatch metrics through the logs API, so no
      # cloudwatch:PutMetricData grant is needed.
      Resource = [
        aws_cloudwatch_log_group.metrics.arn,
        "${aws_cloudwatch_log_group.metrics.arn}:*",
      ]
    }]
  })
}

locals {
  # The collector scrapes the API over the task's loopback interface and
  # republishes it as EMF. `$${env:...}` escapes Terraform interpolation so the
  # collector, not Terraform, resolves the token at runtime.
  #
  # metric_declarations is the cost control: only listed metric/dimension pairs
  # become CloudWatch custom metrics (billed per metric per month). Everything
  # else still lands in the EMF log group and stays queryable. `tenant` is
  # excluded on purpose — promoting it would mint a metric per salon.
  otel_config = <<-YAML
    receivers:
      prometheus:
        config:
          global:
            scrape_interval: ${var.metrics_scrape_interval_seconds}s
            # Prometheus refuses to start if the timeout exceeds the interval,
            # so derive it rather than letting a low interval break the config.
            scrape_timeout: ${min(15, var.metrics_scrape_interval_seconds)}s
          scrape_configs:
            - job_name: aurashine-api
              metrics_path: /metrics
              scheme: http
              authorization:
                type: Bearer
                credentials: $${env:METRICS_AUTH_TOKEN}
              static_configs:
                - targets: ["127.0.0.1:8080"]
    processors:
      resourcedetection:
        detectors: [env, ecs]
        timeout: 5s
      batch/metrics:
        timeout: 60s
    exporters:
      awsemf:
        namespace: AuraShine/${var.environment}
        log_group_name: ${aws_cloudwatch_log_group.metrics.name}
        log_stream_name: "{TaskId}"
        region: ${var.aws_region}
        dimension_rollup_option: NoDimensionRollup
        resource_to_telemetry_conversion:
          enabled: false
        metric_declarations:
          - dimensions: [["route"]]
            metric_name_selectors:
              - "^aurashine_http_request_duration_seconds$"
              - "^aurashine_http_errors_total$"
          - dimensions: [["worker", "outcome"]]
            metric_name_selectors:
              - "^aurashine_worker_cycles_total$"
          # Both sets: [worker, step] to see which job broke, and [] so an
          # alarm has a single aggregate series to watch. NoDimensionRollup
          # means CloudWatch publishes exactly what is declared here and
          # nothing else, so an alarm's dimensions must match a set listed
          # above it.
          - dimensions: [["worker", "step"], []]
            metric_name_selectors:
              - "^aurashine_worker_step_failures_total$"
          - dimensions: [["state"]]
            metric_name_selectors:
              - "^aurashine_db_pool_connections$"
          - dimensions: [[]]
            metric_name_selectors:
              - "^aurashine_metrics_series_dropped_total$"
    service:
      telemetry:
        logs:
          level: warn
      pipelines:
        metrics:
          receivers: [prometheus]
          processors: [resourcedetection, batch/metrics]
          exporters: [awsemf]
  YAML

  backend_secret_names = [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "AI_SERVICE_TOKEN",
    "SECURITY_ENCRYPTION_KEY",
    "MIGRATION_PROOF_SIGNING_KEY",
    "SUPPORT_EMAIL_WEBHOOK_SECRET",
    "METRICS_AUTH_TOKEN",
    "ERROR_WEBHOOK_URL",
    "AWS_REGION",
    "AWS_S3_BUCKET",
    "CORS_ALLOWED_ORIGINS",
  ]
  backend_secrets = [for name in local.backend_secret_names : {
    name      = name
    valueFrom = "${aws_secretsmanager_secret.runtime.arn}:${name}::"
  }]
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name}-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "2048"
  memory                   = "8192"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "migration-files"

    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.migration.id
      transit_encryption = "ENABLED"

      authorization_config {
        access_point_id = aws_efs_access_point.migration.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name         = "backend"
      image        = var.backend_image
      essential    = true
      cpu          = 1024
      user         = "10001"
      portMappings = [{ containerPort = 8080, hostPort = 8080, protocol = "tcp" }]
      environment = [
        { name = "APP_ENV", value = var.environment },
        { name = "APP_HOST", value = "0.0.0.0" },
        { name = "APP_PORT", value = "8080" },
        { name = "AI_SERVICE_URL", value = "http://127.0.0.1:8081" },
        { name = "MIGRATION_CLAMD_ADDRESS", value = "127.0.0.1:3310" },
        { name = "MIGRATION_FILE_STORAGE_ROOT", value = "/var/lib/aurashine/migration-files" },
        { name = "RUST_LOG", value = "info" },
        # The deploy pipeline runs aws_ecs_task_definition.migration before
        # touching this service, so serving tasks must not migrate again: doing
        # so made every task in a rolling deploy queue behind the same advisory
        # lock before it could pass a health check.
        { name = "RUN_MIGRATIONS_ON_BOOT", value = "false" },
        # Workers stay on here because each cycle is leader-elected through a
        # lease in worker_leases, so extra replicas skip rather than duplicate.
        # Flip to "false" once a dedicated single-task worker service exists.
        { name = "RUN_WORKERS", value = "true" },
      ]
      secrets = local.backend_secrets
      mountPoints = [{
        sourceVolume  = "migration-files"
        containerPath = "/var/lib/aurashine/migration-files"
        readOnly      = false
      }]
      dependsOn = [{
        containerName = "ai"
        condition     = "START"
        }, {
        containerName = "clamav"
        condition     = "HEALTHY"
      }]
      linuxParameters = { initProcessEnabled = true }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "backend"
        }
      }
    },
    {
      name      = "ai"
      image     = var.ai_image
      essential = true
      cpu       = 256
      user      = "10001"
      portMappings = [{
        containerPort = 8081
        hostPort      = 8081
        protocol      = "tcp"
      }]
      environment = [
        { name = "OPENAI_MODEL", value = var.openai_model },
      ]
      secrets = [
        { name = "AI_SERVICE_TOKEN", valueFrom = "${aws_secretsmanager_secret.runtime.arn}:AI_SERVICE_TOKEN::" },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.runtime.arn}:OPENAI_API_KEY::" },
      ]
      linuxParameters = { initProcessEnabled = true }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.ai.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ai"
        }
      }
    },
    {
      # Scrapes the backend's /metrics over loopback and republishes it to
      # CloudWatch as EMF. Not essential: losing telemetry must never take the
      # API down with it.
      name              = "otel"
      image             = var.otel_collector_image
      essential         = false
      cpu               = 128
      memoryReservation = 256
      environment = [
        { name = "AOT_CONFIG_CONTENT", value = local.otel_config },
      ]
      secrets = [
        { name = "METRICS_AUTH_TOKEN", valueFrom = "${aws_secretsmanager_secret.runtime.arn}:METRICS_AUTH_TOKEN::" },
      ]
      dependsOn = [{
        containerName = "backend"
        condition     = "START"
      }]
      linuxParameters = { initProcessEnabled = true }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.otel.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "otel"
        }
      }
    },
    {
      name      = "clamav"
      image     = var.clamav_image
      essential = true
      # 768 -> 640 to fund the collector's 128 without growing the task size.
      # Fargate treats container cpu as a share, not a cap, so ClamAV still
      # bursts into idle capacity during a scan.
      cpu               = 640
      memoryReservation = 4096
      portMappings = [{
        containerPort = 3310
        hostPort      = 3310
        protocol      = "tcp"
      }]
      healthCheck = {
        command     = ["CMD-SHELL", "clamdscan --ping 1 || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 10
        startPeriod = 180
      }
      linuxParameters = { initProcessEnabled = true }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.clamav.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "clamav"
        }
      }
    },
  ])

  depends_on = [
    aws_iam_role_policy_attachment.task_execution,
    aws_iam_role_policy.task_execution_secrets,
    aws_secretsmanager_secret_version.runtime,
  ]
}

resource "aws_ecs_task_definition" "migration" {
  family                   = "${local.name}-migration"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "backend"
    image     = var.backend_image
    essential = true
    user      = "10001"
    command   = ["aura-shine-backend", "--migrate-only"]
    environment = [
      { name = "APP_ENV", value = var.environment },
      { name = "APP_HOST", value = "0.0.0.0" },
      { name = "APP_PORT", value = "8080" },
      { name = "RUST_LOG", value = "info" },
    ]
    secrets         = local.backend_secrets
    linuxParameters = { initProcessEnabled = true }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "migration"
      }
    }
  }])

  depends_on = [
    aws_iam_role_policy_attachment.task_execution,
    aws_iam_role_policy.task_execution_secrets,
    aws_secretsmanager_secret_version.runtime,
  ]
}

resource "aws_ecs_service" "app" {
  name            = "${local.name}-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 0
  launch_type     = "FARGATE"

  health_check_grace_period_seconds = 120
  enable_execute_command            = false

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  alarms {
    alarm_names = [
      aws_cloudwatch_metric_alarm.alb_5xx.alarm_name,
      aws_cloudwatch_metric_alarm.unhealthy_targets.alarm_name,
    ]
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "backend"
    container_port   = 8080
  }

  lifecycle {
    ignore_changes = [
      desired_count,
      task_definition,
    ]
  }

  depends_on = [aws_lb_listener.api]
}

resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = var.autoscaling_max_capacity
  min_capacity       = 0
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"

  lifecycle {
    ignore_changes = [min_capacity]
  }
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${local.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
