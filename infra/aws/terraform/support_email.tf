locals {
  support_email_enabled = length(var.support_email_recipient_map) > 0
  support_email_webhook_url = trimspace(var.support_email_webhook_url) != "" ? trimspace(var.support_email_webhook_url) : "https://${aws_cloudfront_distribution.app.domain_name}/api/webhooks/support/email"
  support_email_recipient_map = {
    for recipient, scope in var.support_email_recipient_map : lower(trimspace(recipient)) => {
      tenantId = trimspace(scope.tenant_id)
      branchId = trimspace(scope.branch_id)
    }
  }
  support_email_rule_arn = "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/${trimspace(var.support_email_receipt_rule_set_name)}:receipt-rule/${local.name}-support-email"
}

data "archive_file" "support_email_bridge" {
  count = local.support_email_enabled ? 1 : 0

  type             = "zip"
  source_file      = "${path.module}/../lambda/support_email_bridge.py"
  output_file_mode = "0666"
  output_path      = "${path.module}/.terraform/support-email-bridge.zip"
}

resource "aws_s3_bucket" "support_email" {
  count  = local.support_email_enabled ? 1 : 0
  bucket = "${local.name}-support-email-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "support_email" {
  count = local.support_email_enabled ? 1 : 0

  bucket                  = aws_s3_bucket.support_email[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "support_email" {
  count  = local.support_email_enabled ? 1 : 0
  bucket = aws_s3_bucket.support_email[0].id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "support_email" {
  count  = local.support_email_enabled ? 1 : 0
  bucket = aws_s3_bucket.support_email[0].id
  rule {
    id     = "expire-raw-email"
    status = "Enabled"
    filter { prefix = "raw/" }
    expiration { days = var.support_email_raw_retention_days }
  }
}

resource "aws_s3_bucket_policy" "support_email" {
  count  = local.support_email_enabled ? 1 : 0
  bucket = aws_s3_bucket.support_email[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSESPuts"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.support_email[0].arn}/raw/*"
      Condition = {
        StringEquals = { "AWS:SourceAccount" = data.aws_caller_identity.current.account_id }
        StringLike   = { "AWS:SourceArn" = local.support_email_rule_arn }
      }
    }]
  })
}

resource "aws_sqs_queue" "support_email_dlq" {
  count = local.support_email_enabled ? 1 : 0

  name                       = "${local.name}-support-email-dlq"
  message_retention_seconds  = 1209600
  sqs_managed_sse_enabled    = true
}

resource "aws_cloudwatch_log_group" "support_email" {
  count = local.support_email_enabled ? 1 : 0

  name              = "/aws/lambda/${local.name}-support-email-bridge"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "support_email_lambda" {
  count = local.support_email_enabled ? 1 : 0

  name = "${local.name}-support-email-bridge"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "support_email_lambda" {
  count = local.support_email_enabled ? 1 : 0

  name = "support-email-bridge"
  role = aws_iam_role.support_email_lambda[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.support_email[0].arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.support_email[0].arn}/raw/*"
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.runtime.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.support_email_dlq[0].arn
      }
    ]
  })
}

resource "aws_lambda_function" "support_email_bridge" {
  count = local.support_email_enabled ? 1 : 0

  function_name    = "${local.name}-support-email-bridge"
  role             = aws_iam_role.support_email_lambda[0].arn
  runtime          = "python3.12"
  handler          = "support_email_bridge.handler"
  filename         = data.archive_file.support_email_bridge[0].output_path
  source_code_hash = data.archive_file.support_email_bridge[0].output_base64sha256
  memory_size      = 256
  timeout          = 30

  environment {
    variables = {
      BUCKET_NAME        = aws_s3_bucket.support_email[0].id
      OBJECT_PREFIX      = "raw/"
      RECIPIENT_MAP_JSON = jsonencode(local.support_email_recipient_map)
      RUNTIME_SECRET_ARN = aws_secretsmanager_secret.runtime.arn
      WEBHOOK_URL        = local.support_email_webhook_url
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.support_email,
    aws_iam_role_policy.support_email_lambda,
    aws_secretsmanager_secret_version.runtime,
  ]
}

resource "aws_lambda_function_event_invoke_config" "support_email_bridge" {
  count = local.support_email_enabled ? 1 : 0

  function_name                = aws_lambda_function.support_email_bridge[0].function_name
  maximum_event_age_in_seconds = 21600
  maximum_retry_attempts       = 2
  destination_config {
    on_failure { destination = aws_sqs_queue.support_email_dlq[0].arn }
  }
}

resource "aws_lambda_permission" "support_email_ses" {
  count = local.support_email_enabled ? 1 : 0

  statement_id   = "AllowSesReceiptRule"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.support_email_bridge[0].function_name
  principal      = "ses.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = local.support_email_rule_arn
}

resource "aws_ses_receipt_rule" "support_email" {
  count = local.support_email_enabled ? 1 : 0

  name          = "${local.name}-support-email"
  rule_set_name = trimspace(var.support_email_receipt_rule_set_name)
  recipients    = sort(keys(local.support_email_recipient_map))
  enabled       = true
  scan_enabled  = true
  tls_policy    = "Require"

  s3_action {
    bucket_name       = aws_s3_bucket.support_email[0].id
    object_key_prefix = "raw/"
    position          = 1
  }

  lambda_action {
    function_arn    = aws_lambda_function.support_email_bridge[0].arn
    invocation_type = "Event"
    position        = 2
  }

  depends_on = [
    aws_lambda_permission.support_email_ses,
    aws_s3_bucket_policy.support_email,
  ]
}

output "support_email_bucket" {
  value = local.support_email_enabled ? aws_s3_bucket.support_email[0].id : null
}

output "support_email_lambda" {
  value = local.support_email_enabled ? aws_lambda_function.support_email_bridge[0].function_name : null
}

output "support_email_dead_letter_queue" {
  value = local.support_email_enabled ? aws_sqs_queue.support_email_dlq[0].name : null
}
