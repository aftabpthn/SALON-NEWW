# DEPLOYMENT.md - AuraShine AWS Deployment Standards

## 1. Production Target

AuraShine production runs on AWS with managed services first:

- Rust Axum API: ECS/Fargate service behind ALB.
- Python FastAPI AI service: ECS/Fargate service, private/internal by default.
- PostgreSQL: Amazon RDS PostgreSQL.
- Redis: Amazon ElastiCache Redis.
- Files: S3 bucket, CloudFront optional.
- Logs/metrics: CloudWatch.
- HTTPS: ACM certificate on ALB.

EC2 is allowed only when ECS/Fargate cost or operational constraints require it.

## 2. Runtime Services

### Rust backend

- Container: `backend-rust/Dockerfile`
- Port inside container: `8080`
- Public path through ALB: `/api/*`, `/health`
- Required env:
  - `APP_ENV=production`
  - `APP_HOST=0.0.0.0`
  - `APP_PORT=8080`
  - `DATABASE_URL`
  - `REDIS_URL`
  - `JWT_ACCESS_SECRET`
  - `JWT_REFRESH_SECRET`
  - `JWT_ACCESS_TTL_MINUTES`
  - `JWT_REFRESH_TTL_DAYS`

### Python AI service

- Container: `ai-service/Dockerfile`
- Port inside container: `8081`
- Preferred access: private service-to-service only.
- Required env: `APP_ENV`, `AI_SERVICE_TOKEN`.
- Public exposure is allowed only if bearer auth, rate-limit, and network rules are enforced by the Rust API or ALB rules.

## 3. Database and Cache

### RDS PostgreSQL

- Engine: PostgreSQL 16 compatible.
- Public access: disabled.
- Multi-AZ: enable for production.
- Backups: minimum 7 days, higher for paid enterprise tenants.
- Migrations: Rust API runs `sqlx` migrations on boot.

### ElastiCache Redis

- Engine: Redis 7 compatible.
- Public access: disabled.
- Use for refresh/session cache, rate limits, queues/backpressure, short locks, and temporary state only.
- Do not store durable CRM truth only in Redis.

## 4. Files

Use S3 for uploaded files, exports, invoices, reports, and future media assets.
Migration source evidence uses the encrypted, access-point-scoped EFS volume because the current migration engine requires shared filesystem semantics across ECS replicas and task replacement.

Required production rules:

- Private bucket by default.
- Server-side encryption enabled.
- Public access blocked.
- Pre-signed URLs for downloads/uploads.
- Lifecycle rules for temporary exports.

## 5. Networking

Recommended VPC layout:

- Public subnets: ALB only.
- Private subnets: ECS tasks, RDS, ElastiCache.
- NAT gateway: only if private services need outbound internet.
- Security groups:
  - ALB allows `443` from internet.
  - Rust API allows `8080` from ALB SG only.
  - Python AI allows `8081` from Rust API SG only.
  - RDS allows `5432` from Rust API SG only.
  - Redis allows `6379` from Rust API SG only.

## 6. ALB + HTTPS

- Use ACM certificate for domain.
- Listener `443` forwards to Rust API target group.
- Listener `80` redirects to `443`.
- Health check path: `/health`.
- Recommended timeout: 60 seconds.

Routing:

- `/api/*` -> Rust API target group.
- `/health` -> Rust API target group.
- AI service stays private unless explicitly required.

## 7. CloudWatch

Every ECS task logs to CloudWatch.

Log groups:

- `/aurashine/prod/api`
- `/aurashine/prod/ai`

Minimum alarms:

- ALB 5xx high.
- ECS task restarts.
- RDS CPU/storage/connection pressure.
- ElastiCache CPU/memory/evictions.
- API health check failures.

## 8. Secrets

Use AWS Secrets Manager or SSM Parameter Store.

Never commit:

- JWT secrets
- OAuth secrets
- RDS password
- Redis auth token
- AWS access keys
- third-party API keys

## 9. Deployment Steps

1. Build and push Rust API image to ECR.
2. Build and push Python AI image to ECR.
3. Provision or update RDS PostgreSQL.
4. Provision or update ElastiCache Redis.
5. Create/update ECS task definitions.
6. **Run schema migrations as a dedicated one-off task**
   (`aws_ecs_task_definition.migration`, which runs
   `aura-shine-backend --migrate-only`) and wait for exit code 0.
7. Deploy ECS services.
8. Attach Rust API service to ALB target group.
9. Verify:
   - `GET https://<domain>/health`
   - `GET https://<domain>/api/v1/health`
   - `GET https://<domain>/metrics` with the `METRICS_AUTH_TOKEN` bearer
   - login smoke test after owner/user exists
10. Watch CloudWatch for 30 minutes.

### Why step 6 is separate

Serving tasks run with `RUN_MIGRATIONS_ON_BOOT=false`. Migrating inside every
replica made each task in a rolling deploy queue behind the same advisory lock
before it could pass a health check, so deploys crawled and could trip the
deployment circuit breaker. `--migrate-only` migrates regardless of that flag,
so the dedicated task cannot be switched off by configuration.

Lock-safety rules for the migrations themselves are in
`docs/SCHEMA_MIGRATION_SAFETY.md`. Schema changes go out 03:00–05:00 IST.

### Background workers

Workers run inside the API tasks, but each cycle is leader-elected through a
lease in `worker_leases`: one replica holds tenure and the others skip. Before
this, a service scaled to eight tasks ran eight copies of every worker loop.

Set `RUN_WORKERS=false` on the API tasks once a dedicated single-task worker
service exists. Until then leave it `true` — the lease makes extra replicas
free.

Ownership during an incident:

```sql
SELECT worker_name, holder_id, renewed_at, expires_at > NOW() AS valid
FROM worker_leases ORDER BY worker_name;
```

## 10. Rollback

- App issue: redeploy previous ECS task definition.
- Migration issue: migrations are additive-first; rollback app image first.
- Data issue: restore RDS snapshot only after owner approval.

## 11. Acceptance Criteria

- API is reachable through HTTPS only.
- RDS and Redis are private.
- Secrets are not in source code or container image.
- Health checks pass before traffic cutover.
- CloudWatch logs exist for Rust and Python services.
