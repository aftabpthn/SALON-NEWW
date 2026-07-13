# AWS Infrastructure Plan

This folder documents the production AWS target. Add Terraform/CDK here when infra is ready to be provisioned.

## Services

- ECS/Fargate: Rust API and Python AI containers.
- ECR: container images.
- RDS PostgreSQL: durable CRM database.
- ElastiCache Redis: cache, locks, refresh/session support.
- S3: files, exports, reports, invoices.
- ALB + ACM: HTTPS ingress.
- CloudWatch: logs, metrics, alarms.

## Environments

Use separate AWS resources per environment:

- `dev`
- `staging`
- `prod`

Do not share production RDS/Redis with dev or staging.
