# AWS Backup Strategy

## Scope

- SQLite database backups for the current application stack.
- S3 file storage backups and lifecycle retention.
- Glacier archival for long-term retention.
- Restore drills and monitoring.
- MongoDB Atlas backup notes for a future approved database migration.

## Recovery Objectives

| Data | RPO | RTO | Notes |
| --- | --- | --- | --- |
| SQLite database | 24 hours initially, 4 hours after scheduler hardening | 2 hours | Use online backup and verified restore |
| Uploaded files | 24 hours | 4 hours | S3 versioning and lifecycle |
| Secrets | Manual recovery via Secrets Manager | 1 hour | Do not export plaintext secrets |
| Frontend artifact | Per deployment | 30 minutes | Roll back S3 prefix/CloudFront origin |

## Backup Storage

- Primary backup bucket: `s3://<backup-bucket>/<env>/database/`.
- File storage bucket: `s3://<file-bucket>/<tenantId>/<branchId>/...`.
- Backup evidence prefix: `s3://<backup-bucket>/<env>/restore-drills/`.
- Enable versioning and SSE-KMS on backup and file buckets.
- Optional: enable S3 Object Lock in governance mode for production backups.

## Database Backup Flow

1. Run `npm run backup:db` on the backend host or controlled backup job.
2. Create an online SQLite backup without stopping the app.
3. Compress backup artifact.
4. Encrypt with app backup key or KMS-backed process.
5. Generate checksum file.
6. Upload backup, checksum, and metadata to S3.
7. Emit CloudWatch metric `BackupSuccess=1`.
8. Alert if backup does not complete within the expected window.

## File Backup Flow

1. Store uploads directly in S3 with versioning enabled after S3 upload integration is active.
2. For any local legacy files, sync to S3 on a schedule.
3. Use lifecycle rules for older versions.
4. Keep delete markers and noncurrent versions long enough to recover accidental deletion.

## Glacier Lifecycle

- Daily database backups: keep hot for 30 days, Glacier Instant/Flexible after 30 days, Deep Archive after 180 days.
- Weekly backups: keep for 12 months.
- Monthly backups: keep for 7 years if compliance requires it.
- File noncurrent versions: Glacier after 90 days, expire after policy approval.

## Restore Drill

1. Pick latest backup from S3.
2. Download to isolated restore host or CI job with no production write access.
3. Verify checksum.
4. Decrypt artifact.
5. Restore SQLite file to scratch path.
6. Run SQLite integrity check.
7. Run app-level smoke reads against restored data where feasible.
8. Write restore evidence to S3 and CloudWatch.
9. Record duration and failures.

## Production Restore Flow

1. Declare incident and freeze writes.
2. Snapshot current damaged state before any restore.
3. Select restore point.
4. Restore database to new encrypted volume/path.
5. Run integrity checks.
6. Start backend against restored database.
7. Run smoke tests.
8. Reopen traffic through ALB.
9. Keep damaged snapshot until incident review completes.

## MongoDB Atlas Future Backup Notes

- Enable Atlas continuous cloud backups and point-in-time recovery.
- Keep Atlas backup policy aligned with S3 backup retention.
- Export critical monthly snapshots to S3 only after approval and encryption review.
- This is future-only until application data layer migration is approved.

## Monitoring

- CloudWatch alarm for missing backup metric.
- CloudWatch alarm for failed restore drill.
- S3 Storage Lens or bucket metrics for unexpected delete spikes.
- AWS Budgets alert for backup storage growth.

## Cost-Control Notes

- Use lifecycle transitions automatically.
- Keep CloudWatch logs retention finite.
- Avoid frequent Deep Archive restores; test restores from recent hot/Glacier Instant backups.
- Review backup bucket size monthly.
