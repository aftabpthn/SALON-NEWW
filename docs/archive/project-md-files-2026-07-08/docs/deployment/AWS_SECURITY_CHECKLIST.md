# AWS Security Checklist

## Identity And Access

- Use IAM roles for EC2/ECS and CI OIDC; do not use static AWS keys.
- Apply least privilege per environment.
- Separate production, staging, and development roles.
- Require MFA for AWS console administrators.
- Rotate human access through IAM Identity Center.
- Keep secrets in AWS Secrets Manager, not in `.env` files committed to Git.

## Network Security

- Backend instances/tasks run in private subnets.
- ALB accepts HTTPS only.
- Backend security group accepts traffic only from ALB security group.
- SSH/RDP is disabled by default; use SSM Session Manager if break-glass access is required.
- Use VPC endpoints for S3, Secrets Manager, CloudWatch Logs, and ECR where cost-approved.
- If MongoDB Atlas is later approved, prefer PrivateLink; otherwise use strict IP allowlists.

## WAF Rules

- Attach AWS WAF to CloudFront.
- Enable AWS managed common rule set.
- Enable known bad inputs and SQLi/XSS managed rules.
- Add rate limit rule for `/api/*`.
- Add stricter rate limits for auth routes.
- Block obvious bot/user-agent abuse if confirmed by logs.
- Log WAF events to CloudWatch Logs or S3 with retention policy.

## Application Runtime

- `NODE_ENV=production`.
- `TRUST_PROXY=true` behind ALB/CloudFront.
- `WAF_PROVIDER=aws`.
- `CORS_ORIGINS` must be explicit HTTPS origins only.
- `DISABLE_CSP=false`.
- `RELAX_CSP=false`.
- `ALLOW_LEGACY_API_AUTH_BYPASS=false`.
- `ALLOW_LEGACY_REFRESH_TOKEN_BODY=false`.
- `ADMIN_MFA_REQUIRED=true`.
- Refresh cookie should use `__Host-` prefix and `SameSite=Strict` unless a cross-site app domain is explicitly approved.

## Data Protection

- Encrypt EBS volumes with KMS.
- Encrypt S3 buckets with SSE-KMS.
- Encrypt backups before upload when using app-level backup encryption.
- Store `BACKUP_ENCRYPTION_KEY` in Secrets Manager.
- Enable S3 versioning for file and backup buckets.
- Enable Object Lock for backup bucket if compliance requires immutability.
- Never log secrets, tokens, OTPs, raw PII, or payment credentials.

## S3 Policies

- Block all public access on all buckets.
- Frontend S3 bucket is readable only by CloudFront Origin Access Control.
- File bucket allows backend role access only to approved prefixes.
- Backup bucket write access limited to backup role.
- Deny unencrypted object uploads.
- Deny non-TLS requests with `aws:SecureTransport=false`.

## Secrets Manager

- One secret per environment, for example `/aura/prod/api/env`.
- Store app secrets as key/value JSON.
- Restrict read access to backend runtime role and deployment role.
- Enable rotation where provider supports it.
- Do not store real secrets in `.env.aws.example`.

## CloudWatch Alarms

- ALB 5xx count and target 5xx count.
- ALB target unhealthy host count.
- API process restart count or health check failure.
- CPU and memory pressure.
- EBS free disk space for SQLite host.
- Backup failure or missed backup.
- WAF blocked request spike.
- Auth failure spike.
- S3 4xx/5xx unusual activity.

## Production Security Gate

- Run secret scan before deployment.
- Run production security gate before traffic shift.
- Confirm no development secrets are present.
- Confirm no public S3 ACLs.
- Confirm WAF logs are enabled.
- Confirm backup restore drill is completed.
