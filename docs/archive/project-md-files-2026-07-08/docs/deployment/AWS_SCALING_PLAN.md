# AWS Scaling Plan

## Current Constraint

The current backend uses SQLite via `better-sqlite3`. Horizontal write scaling is limited until an approved database migration or leader/single-writer architecture exists. The safe production baseline is one active writer with Auto Scaling used for replacement and controlled failover.

MongoDB Atlas horizontal scaling is a future target only after explicit approval and application data-layer changes.

## Frontend Scaling

- S3 stores static Angular assets.
- CloudFront caches assets globally.
- Use hashed asset names from Angular build.
- Cache `index.html` for a short TTL.
- Invalidate `index.html` on deployment.
- Use compression and HTTP/2/HTTP/3 through CloudFront.

## Backend EC2 Baseline

- Use ALB target group with health checks on `/health`.
- Use Auto Scaling Group minimum 1, desired 1 for SQLite write safety.
- Use warm standby only if database volume attach/failover runbook is tested.
- Scale vertically first: CPU, memory, and EBS IOPS.
- Use CloudWatch alarms to replace unhealthy instances.

## Backend ECS Future

- Use ECS service autoscaling on CPU, memory, and ALB request count.
- Use minimum 2 tasks across AZs after DB supports horizontal access.
- Store secrets in Secrets Manager.
- Send logs to CloudWatch.
- Use rolling deployments with health checks.

## Load Balancer

- ALB terminates HTTPS or receives HTTPS from CloudFront origin.
- Route `/api/*` to backend target group.
- Support WebSocket upgrade for realtime features.
- Configure idle timeout suitable for WebSocket usage.
- Enable access logs to S3 if cost-approved.

## Database Scaling

### Current SQLite

- Keep database on encrypted EBS with adequate IOPS.
- Keep transactions short.
- Run analytics/reporting jobs off-peak.
- Use backups and restore drills for resilience.
- Do not run multiple active writers on separate SQLite files.

### Future MongoDB Atlas

- Requires explicit approval before implementation.
- Use M10+ dedicated cluster for production baseline.
- Enable auto-scaling storage.
- Add read replicas only after query patterns are validated.
- Validate tenant/branch isolation in every migrated query.

## File Storage Scaling

- Store uploads in S3.
- Serve files through signed URLs or CloudFront private distribution after auth decision.
- Use multipart upload for large files if needed.
- Keep object prefixes tenant/branch scoped.

## Queue/Worker Scaling Future

- Long-running jobs should move to workers before API scale-out.
- Candidate jobs: reports, notifications, backups, exports.
- Use SQS/EventBridge only after workflow approval.

## Scaling Metrics

- ALB request count per target.
- ALB target response time p95/p99.
- Backend CPU and memory.
- Event loop delay if instrumented.
- EBS queue length and burst balance.
- SQLite database size and backup duration.
- CloudFront cache hit rate.
- S3 4xx/5xx errors.

## Cost-Control Notes

- Prefer CloudFront caching over backend scaling for static traffic.
- Start with small EC2 and right-size from metrics.
- Avoid over-provisioned NAT Gateways in non-production.
- Use scheduled scaling only after usage pattern is known.
- Set AWS Budgets alerts for compute, data transfer, CloudWatch, and S3.

## Production Readiness Checklist

- ALB health check passes.
- Auto Scaling replacement tested.
- Backend can restart and reconnect using Secrets Manager env.
- Backup completes during peak-like load.
- Restore drill completed.
- CloudFront cache behavior tested for `/api/*` and SPA routes.
- WAF false positives reviewed.
- Rollback path tested.
