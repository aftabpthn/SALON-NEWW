# Aura CRM/POS AWS Infrastructure Baseline

Terraform baseline for AWS deployment planning. It prepares safe infrastructure templates for the Angular frontend, Express backend, S3 storage, WAF, CloudWatch, and backups without changing application code or the current SQLite runtime architecture.

## Included

- Private S3 frontend bucket with CloudFront Origin Access Control.
- Optional CloudFront `/api/*` routing to an ALB origin.
- Private uploads, backup, and audit buckets with encryption and public access blocks.
- KMS key, Secrets Manager secret placeholder, CloudWatch log groups, SNS alerts.
- WAF managed rules and optional ALB association.
- Optional EC2 + ALB + Auto Scaling baseline for the current SQLite deployment.
- Backup/upload lifecycle rules for Glacier transition.

## Not Included Yet

- Real AWS keys or secrets.
- Application code changes.
- MongoDB Atlas implementation. Atlas requires separate approval and data-layer migration.
- Production artifact bootstrap. `user-data-backend.sh.tftpl` is intentionally a safe placeholder.

## Apply

```sh
terraform init
terraform plan -var="aws_region=ap-south-1" -var="alert_email=owner@example.com"
terraform apply -var="aws_region=ap-south-1" -var="alert_email=owner@example.com"
```

Use `terraform.tfvars.example` as a safe starting point. Keep `create_backend_ec2=false` until VPC, subnet, AMI, certificate, and SQLite persistence details are reviewed.

After apply, populate the generated Secrets Manager secret with the production JSON secret map and set the app env values from the outputs:

- `AWS_REGION`
- `AWS_SECRETS_ENABLED=true`
- `AWS_SECRET_ID`
- `AWS_KMS_KEY_ALIAS`
- `AWS_CLOUDWATCH_SECURITY_LOG_GROUP`
- `AWS_S3_UPLOADS_ENABLED`
- `AWS_UPLOAD_BUCKET`
- `AWS_UPLOAD_PREFIX`
- `AWS_BACKUP_BUCKET`
- `AWS_BACKUP_PREFIX`
- `artifact_bucket` for backend release artifacts

Use an IAM role/task role for the app. Do not put AWS access keys in `.env`.

## Frontend Deployment Flow

1. Build Angular: `npm run build`.
2. Sync build output to the `frontend_bucket` output.
3. Invalidate CloudFront `index.html` after deployment.
4. Route API traffic through CloudFront `/api/*` only after `backend_alb_dns_name` is known.

## Backend EC2 Notes

- Keep `backend_min_size`, `backend_desired_capacity`, and `backend_max_size` at `1` while SQLite is the primary database.
- Use encrypted EBS for the SQLite file.
- Use the generated Secrets Manager secret for runtime env.
- Replace the placeholder user data with reviewed artifact download/start automation in a separate approved change.

## Automation Scripts

See `../deployment/RUNBOOK.md` and `../scripts/` for safe deployment helper templates.
