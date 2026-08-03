resource "aws_security_group" "migration_efs" {
  name        = "${local.name}-migration-efs"
  description = "Allow migration evidence storage only from AuraShine ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
}

resource "aws_efs_file_system" "migration" {
  creation_token   = "${local.name}-migration"
  encrypted        = true
  kms_key_id       = aws_cloudformation_stack.data_protection.outputs["EncryptionKeyArn"]
  performance_mode = "generalPurpose"
  throughput_mode  = "elastic"

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = { Name = "${local.name}-migration" }
}

resource "aws_efs_mount_target" "migration" {
  count = length(aws_subnet.private)

  file_system_id  = aws_efs_file_system.migration.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.migration_efs.id]
}

resource "aws_efs_access_point" "migration" {
  file_system_id = aws_efs_file_system.migration.id

  posix_user {
    uid = 10001
    gid = 10001
  }

  root_directory {
    path = "/migration-files"

    creation_info {
      owner_uid   = 10001
      owner_gid   = 10001
      permissions = "0750"
    }
  }
}
