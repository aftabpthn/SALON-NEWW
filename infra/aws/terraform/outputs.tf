output "application_url" {
  value = "https://${aws_cloudfront_distribution.app.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.app.id
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.id
}

output "file_bucket" {
  value = aws_cloudformation_stack.data_protection.outputs["FileBucketName"]
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "ecs_desired_count" {
  value = var.desired_count
}

output "ecs_autoscaling_min_capacity" {
  value = var.autoscaling_min_capacity
}

output "ecs_autoscaling_max_capacity" {
  value = var.autoscaling_max_capacity
}

output "app_task_definition_arn" {
  value = aws_ecs_task_definition.app.arn
}

output "migration_task_definition_arn" {
  value = aws_ecs_task_definition.migration.arn
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "ecs_security_group_id" {
  value = aws_security_group.ecs.id
}

output "runtime_secret_arn" {
  value = aws_secretsmanager_secret.runtime.arn
}

output "rds_instance_identifier" {
  value = aws_db_instance.postgres.identifier
}

output "rds_subnet_group_name" {
  value = aws_db_subnet_group.main.name
}

output "rds_security_group_id" {
  value = aws_security_group.database.id
}

output "rds_instance_class" {
  value = aws_db_instance.postgres.instance_class
}

output "backup_vault_name" {
  value = aws_cloudformation_stack.data_protection.outputs["BackupVaultName"]
}
