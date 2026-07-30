resource "random_password" "database" {
  length  = 40
  special = false
}

resource "random_password" "redis" {
  length  = 40
  special = false
}

resource "random_password" "jwt_access" {
  length  = 64
  special = false
}

resource "random_password" "jwt_refresh" {
  length  = 64
  special = false
}

resource "random_password" "ai_service" {
  length  = 64
  special = false
}

resource "random_password" "security_encryption" {
  length  = 64
  special = false
}

resource "random_password" "support_email_webhook" {
  length  = 64
  special = false
}

resource "random_password" "origin_header" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-database"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${local.name}-postgres16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name}-postgres"

  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = var.db_instance_class
  allocated_storage           = var.db_allocated_storage_gb
  max_allocated_storage       = var.db_max_allocated_storage_gb
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "aurashine"
  username                    = "aurashine_admin"
  password                    = random_password.database.result
  port                        = 5432
  multi_az                    = var.db_multi_az
  publicly_accessible         = false
  db_subnet_group_name        = aws_db_subnet_group.main.name
  parameter_group_name        = aws_db_parameter_group.postgres.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  backup_retention_period     = var.db_backup_retention_days
  backup_window               = "19:00-20:00"
  maintenance_window          = "sun:20:30-sun:21:30"
  auto_minor_version_upgrade  = true
  deletion_protection         = var.db_deletion_protection
  copy_tags_to_snapshot       = true
  performance_insights_enabled = var.environment == "prod"
  enabled_cloudwatch_logs_exports = [
    "postgresql",
    "upgrade",
  ]

  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${local.name}-final" : null
  apply_immediately         = var.environment != "prod"
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name}-redis"
  description          = "AuraShine ${var.environment} cache and session store"

  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  port                       = 6379
  num_cache_clusters         = var.redis_node_count
  automatic_failover_enabled = var.redis_node_count > 1
  multi_az_enabled           = var.redis_node_count > 1
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result
  snapshot_retention_limit   = var.environment == "prod" ? 7 : 1
  snapshot_window            = "18:00-19:00"
  maintenance_window         = "sun:21:30-sun:22:30"
  auto_minor_version_upgrade = true
  apply_immediately          = var.environment != "prod"
}

resource "aws_iam_role" "backup" {
  name = "${local.name}-backup"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "backup.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_cloudformation_stack" "data_protection" {
  name          = "${local.name}-data-protection"
  template_body = file("${path.module}/../data-protection.yaml")

  parameters = {
    Environment          = var.environment
    ProtectedResourceArn = aws_db_instance.postgres.arn
    BackupRoleArn        = aws_iam_role.backup.arn
  }

  on_failure = "ROLLBACK"
}

resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${local.name}/runtime"
  description             = "Generated AuraShine ${var.environment} runtime configuration"
  recovery_window_in_days = var.environment == "prod" ? 30 : 7
}

locals {
  runtime_secret = {
    DATABASE_URL = format(
      "postgresql://aurashine_admin:%s@%s:5432/aurashine?sslmode=require",
      random_password.database.result,
      aws_db_instance.postgres.address,
    )
    REDIS_URL = format(
      "rediss://:%s@%s:6379/0",
      random_password.redis.result,
      aws_elasticache_replication_group.redis.primary_endpoint_address,
    )
    JWT_ACCESS_SECRET       = random_password.jwt_access.result
    JWT_REFRESH_SECRET      = random_password.jwt_refresh.result
    AI_SERVICE_TOKEN       = random_password.ai_service.result
    SECURITY_ENCRYPTION_KEY = random_password.security_encryption.result
    SUPPORT_EMAIL_WEBHOOK_SECRET = random_password.support_email_webhook.result
    OPENAI_API_KEY         = var.openai_api_key
    AWS_REGION             = var.aws_region
    AWS_S3_BUCKET          = aws_cloudformation_stack.data_protection.outputs["FileBucketName"]
    CORS_ALLOWED_ORIGINS = join(",", concat(
      ["https://${aws_cloudfront_distribution.app.domain_name}"],
      var.extra_cors_allowed_origins,
    ))
  }
}

resource "aws_secretsmanager_secret_version" "runtime" {
  secret_id     = aws_secretsmanager_secret.runtime.id
  secret_string = jsonencode(local.runtime_secret)
}
