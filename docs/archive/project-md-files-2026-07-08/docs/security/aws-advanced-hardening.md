# AWS Advanced Security Hardening

This stage prepares Aura CRM/POS for AWS without replacing the current Angular + Express + SQLite/Docker architecture.

## App Runtime

- Secrets come from AWS Secrets Manager only when `NODE_ENV=production` and `AWS_SECRETS_ENABLED=true`.
- Required production env: `AWS_REGION`, `AWS_SECRET_ID`, `AWS_KMS_KEY_ALIAS`, `TRUST_PROXY=true`, `WAF_PROVIDER=aws`.
- CloudWatch security events are emitted only when `AWS_CLOUDWATCH_SECURITY_LOG_GROUP` is set.
- S3 presigned uploads stay disabled unless `AWS_S3_UPLOADS_ENABLED=true`.

## WAF Route Groups

| Group | Route pattern | AWS WAF control |
| --- | --- | --- |
| Auth | `/api/v1/auth/*`, `/api/v1/mfa/*`, `/api/v1/webauthn/*` | Login rate rule, common rule set, known bad inputs |
| Booking public | `/api/v1/booking-portal/*`, `/api/v1/public-booking-*` | Common rule set, SQLi rule set, bad inputs |
| Uploads | `/api/v1/migration/*upload*`, `/api/v1/security/uploads/presign` | Size limits in app, WAF managed rules, S3 private bucket |
| Reports/export | `/api/v1/*report*`, `/api/v1/*export*`, `/api/v1/security/backups*` | Managed rules plus app RBAC, CSRF and export protection |
| Admin/security | `/api/v1/security/*`, `/api/v1/admin/*` | Managed rules, RBAC, CloudWatch security events |

## AWS Evidence Mapping

- App restore drill endpoint: `POST /api/v1/security/backups/:id/verify-restore`.
- AWS evidence bucket: encrypted S3 backup/audit buckets from Terraform.
- Restore evidence should attach the app drill result: `status`, `checksumOk`, `integrityOk`, `backupId`, `drillId`, and timestamp.
- CloudTrail records AWS control-plane actions: IAM, KMS, Secrets Manager, S3, WAF, GuardDuty and Security Hub changes.

## Secret JSON Shape

Store only required keys in the Secrets Manager secret:

```json
{
  "JWT_SECRET": "replace-with-strong-secret",
  "ENCRYPTION_SECRET": "replace-with-different-strong-secret",
  "DB_ENCRYPTION_KEY": "replace-with-db-key",
  "RAZORPAY_KEY_SECRET": "replace-if-used",
  "WHATSAPP_ACCESS_TOKEN": "replace-if-used",
  "OPENAI_API_KEY": "replace-if-used"
}
```

Never store AWS access keys in this secret. The app should run with an IAM role.
