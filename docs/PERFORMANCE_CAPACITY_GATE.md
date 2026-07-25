# Performance capacity gate

## Status rule

AuraShine is not considered proven for 100 branches because load-test files exist or because a developer machine feels fast. Proof requires a passing, repeatable staging run on production-like infrastructure with correlated application and AWS evidence.

## Acceptance budgets

| Surface | Required result |
| --- | --- |
| Normal authenticated API | p95 `< 500 ms` |
| Dashboard/report API | p95 `< 2 s` |
| Organization report over at least 100 real branches | p95 `< 2 s` |
| Branch switch including refresh-token rotation | p95 `< 1 s` |
| API error rate | `< 1%` |
| Pool-pressure run | No connection-pool errors and no dropped k6 iterations |
| Redis cache | Cache hits and misses captured for the exact run window; target ratio recorded before tuning |
| PostgreSQL | Maximum connections, CPU, read/write latency, waits, and queries `>=500 ms` captured |

The Redis hit-rate target is not hard-coded until the first representative baseline identifies which tested endpoints are intentionally cacheable. A latency-only guess is not accepted as a cache hit. The AWS evidence collector calculates the real ElastiCache ratio from `CacheHits` and `CacheMisses`.

## Workload model

The baseline is a mixed workload totaling the configured concurrency:

```text
normal authenticated reads
  + branch dashboard/report reads
  + 100-branch organization report
  + refresh-token branch switches
```

The setup gate uses `/api/v1/settings/branches/page` and requires at least 100 real database branches. The organization scenario uses `/api/v1/settings/multi-branch/command-center`. Branch switching uses `/api/v1/auth/switch-branch` with independent real staging sessions because refresh tokens rotate.

The pool profile uses a constant arrival rate against a database-backed endpoint. Increase RPS in controlled steps until the first failed run. The highest passing run is the safe measured point for that exact infrastructure and dataset, not a universal capacity promise.

## Evidence package

Every sign-off package must identify:

- backend image SHA and migration version;
- ECS desired/running task count, task CPU, and memory;
- RDS engine/class/storage and Redis node class/count;
- number of branches and representative counts for appointments, clients, invoices, and inventory rows;
- VUs, RPS, duration, AWS region, and exact UTC window;
- k6 threshold summary;
- ALB p95 and target 5xx;
- RDS connections, CPU, read latency, write latency, waits, and slow-query results;
- Redis cache hit percentage, current connections, and evictions.

Keep the passing baseline, highest passing pool run, and first failing pool run together. A change to instance class, task count, database indexes, connection pool, cache policy, or representative dataset invalidates comparison unless the new environment metadata is recorded.

## Execution

Use the manual `Performance capacity gate` GitHub workflow with the protected `staging` environment. Required protected configuration:

| Name | Type |
| --- | --- |
| `PERF_BASE_URL` | Environment variable |
| `PERF_EXPECTED_BRANCHES` | Environment variable, normally `100` |
| `PERF_BRANCH_SWITCH_VUS` | Environment variable |
| `PERF_USERS_JSON` | Environment secret |
| `AWS_REGION` | Environment variable |
| `AWS_ROLE_ARN` | Environment variable for read-only CloudWatch, Logs, RDS, ElastiCache, and ELB evidence |

The staging RDS parameter group must set `log_min_duration_statement=500` and export PostgreSQL logs to CloudWatch. The evidence collector checks that value and fails rather than accepting an unobservable run.

The complete operator contract is in `backend-rust/load-tests/README.md`.

## Current large-export boundary

Multi-branch downloads remain synchronous. On-demand custom report exports now use a durable tenant/branch-scoped job contract: `POST /api/reports/exports` with `Idempotency-Key` queues a job, `GET /api/reports/exports/:id` returns status, and the protected download URL is exposed only after completion. The backend worker claims queued jobs with `SKIP LOCKED`; benchmark this queue separately in staging before using it as capacity proof.

