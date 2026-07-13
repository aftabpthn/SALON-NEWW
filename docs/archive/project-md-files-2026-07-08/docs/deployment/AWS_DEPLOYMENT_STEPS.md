# AWS Deployment Steps

## Prerequisites

- AWS account with an isolated production account or at least isolated production IAM roles.
- Domain in Route 53 or an external DNS provider.
- ACM certificate in `us-east-1` for CloudFront.
- ACM certificate in the workload region for ALB if ALB is public HTTPS.
- MongoDB Atlas project only if future DB migration is explicitly approved.
- No real AWS keys in files. Use IAM roles, SSO, or CI OIDC.

## 1. Create Core AWS Resources

1. Create VPC with two public and two private subnets.
2. Add Internet Gateway for public subnets.
3. Add NAT Gateway only if private backend needs outbound internet.
4. Add S3 Gateway Endpoint for private S3 access.
5. Create KMS keys for app secrets, file storage, and backups.
6. Create AWS Secrets Manager secret for backend production environment.

## 2. Create S3 Buckets

1. Frontend bucket: private, public access blocked.
2. File bucket: private, SSE-KMS, versioning enabled.
3. Backup bucket: private, SSE-KMS, versioning enabled, Object Lock optional.
4. Log bucket: private, for ALB/CloudFront/S3 access logs if enabled.
5. Add lifecycle rules:
   - frontend old versions: expire after 30 days.
   - file bucket noncurrent versions: transition to Glacier after 90 days.
   - backup bucket: daily backups to Glacier Instant Retrieval or Flexible Retrieval after 30 days, Deep Archive after 180 days.

## 3. Deploy Frontend

1. Build locally or in CI: `npm run build`.
2. Upload Angular build output to the frontend S3 bucket.
3. Create CloudFront distribution with Origin Access Control.
4. Set default origin to frontend S3.
5. Add behavior `/api/*` pointing to ALB origin.
6. Add behavior for WebSocket/API paths with caching disabled.
7. Configure SPA fallback: 403 and 404 return `/index.html` with HTTP 200.
8. Attach AWS WAF web ACL.
9. Point DNS `app.example.com` to CloudFront.

## 4. Deploy Backend On EC2 Current Path

1. Create IAM role for EC2 with least privilege:
   - read app secret from Secrets Manager.
   - write CloudWatch logs.
   - read/write file S3 prefix.
   - write backup S3 prefix.
   - use required KMS keys.
2. Create launch template with hardened AMI, encrypted EBS, and no public SSH by default.
3. Install Node runtime compatible with the project.
4. Fetch application artifact from CI artifact storage or GitHub release.
5. Install production dependencies with lockfile discipline.
6. Load env from Secrets Manager or generated secure `.env` on instance.
7. Run production preflight: `npm run security:phase5` if deployment window allows.
8. Start API with `npm run start:prod` under a process manager approved for production.
9. Configure ALB target group health check against `/health`.
10. Enable ALB stickiness only if required by WebSocket/session behavior.

## 5. Deploy Backend On ECS Future Path

1. Build container image in CI.
2. Push image to ECR.
3. Create ECS cluster and Fargate service behind ALB.
4. Inject secrets from Secrets Manager.
5. Mount no local database unless an approved persistence design exists.
6. Use ECS only after SQLite persistence or MongoDB Atlas migration approval is complete.

## 6. Database Setup

### Current SQLite

1. Store `data/salon-crm.sqlite` on encrypted EBS.
2. Keep one active writer instance unless an approved database migration exists.
3. Use `npm run backup:db` for online backup.
4. Copy backup artifacts to S3 backup bucket.
5. Run restore drill monthly.

### MongoDB Atlas Future Target

1. Create Atlas project and cluster only after approval.
2. Enable backups, point-in-time recovery, and audit logs.
3. Configure PrivateLink or strict IP allowlist.
4. Store connection string in Secrets Manager.
5. Do not point production app to Atlas until code migration and verification are approved.

## 7. File Storage Setup

1. Enable `AWS_S3_UPLOADS_ENABLED=true` only after S3 upload integration is configured and tested.
2. Use tenant/branch prefixing.
3. Reject public ACLs.
4. Generate short-lived signed URLs from backend only.
5. Add malware scanning workflow later if uploads include customer documents or images.

## 8. Deployment Flow

1. CI checks: secret scan, server check, security gate, frontend build.
2. Build frontend artifact and backend artifact/container.
3. Upload frontend to versioned S3 prefix.
4. Deploy backend to staging target group.
5. Run smoke checks: `/health`, login, one authenticated read, one non-mutating report.
6. Shift ALB/CloudFront traffic.
7. Invalidate CloudFront cache for `index.html` and changed assets if file names are not fully hashed.
8. Record deployment version, commit, and rollback artifact.

## 9. Rollback Flow

1. Repoint ALB target group to previous healthy backend version.
2. Restore previous frontend S3 prefix or CloudFront origin path.
3. Do not restore database automatically unless data corruption is confirmed.
4. If database restore is required, stop writes, restore verified backup, run integrity checks, then reopen traffic.

## Production Checklist

- `NODE_ENV=production`.
- `TRUST_PROXY=true` behind ALB/CloudFront.
- `WAF_PROVIDER=aws`.
- `CORS_ORIGINS` contains only HTTPS production domains.
- `JWT_SECRET`, `ENCRYPTION_SECRET`, and `BACKUP_ENCRYPTION_KEY` are unique production secrets.
- CSP is not disabled or relaxed.
- MFA required for admin.
- S3 buckets block public access.
- CloudWatch alarms configured.
- Backup and restore drill completed before go-live.
