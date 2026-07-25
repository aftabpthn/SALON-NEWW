# Performance capacity gate

This suite proves a specific deployed environment against the AuraShine latency and capacity budgets. The presence of the scripts is not performance proof; a passing staging run and its AWS evidence artifacts are the proof.

## Safety and data requirements

- Run `baseline` and `pool` against an isolated staging environment, never production.
- `K6_USERS_JSON` must contain real staging users. The suite does not create salons, branches, users, appointments, invoices, or other business data.
- The first user must be an owner/admin who can list branches and open organization reports.
- Every branch ID must be the canonical `branches.id` UUID.
- Branch switching rotates refresh tokens. Supply at least `K6_BRANCH_SWITCH_VUS` distinct user identities, each with access to both `branchId` and `targetBranchId`.
- Store `K6_USERS_JSON` as a protected secret. Do not commit it or place it in an artifact.

`K6_USERS_JSON` is a JSON array. Each item has these fields:

| Field | Required | Purpose |
| --- | --- | --- |
| `tenantContext` | Yes | Tenant UUID, slug, domain, or configured login alias |
| `loginId` | Yes | Staging login identity |
| `password` | Yes | Staging password |
| `branchId` | Yes | Initial canonical branch UUID |
| `targetBranchId` | Baseline/smoke | Second canonical branch UUID |
| `mfaCode` | When enforced | Current staging MFA code |

## Profiles

| Profile | Workload | Primary acceptance |
| --- | --- | --- |
| `smoke` | One VU per normal, dashboard, multi-branch, and branch-switch path | Contracts work and thresholds are evaluated |
| `baseline` | Mixed constant concurrency totaling `K6_VUS` | Normal p95 `<500 ms`, dashboard and 100-branch report p95 `<2 s`, switch p95 `<1 s`, errors `<1%` |
| `pool` | Constant arrival rate at `K6_POOL_RPS` | No dropped iterations, connection-pool errors, or p95 above `2 s` |

The setup phase pages through the real branch API and fails unless it finds at least `K6_EXPECTED_BRANCHES` branches. The baseline's multi-branch scenario calls the actual command-center report, so a 100-branch pass cannot be produced from invented branch headers.

## Run locally

Set `K6_BASE_URL`, `K6_USERS_JSON`, and the optional tuning variables in the current shell, then run from the repository root:

```powershell
New-Item -ItemType Directory -Force backend-rust/load-tests/artifacts | Out-Null
docker run --rm -e K6_BASE_URL -e K6_USERS_JSON -e K6_PROFILE -e K6_VUS -e K6_DURATION -e K6_EXPECTED_BRANCHES -e K6_BRANCH_SWITCH_VUS -e K6_POOL_RPS -e K6_SUMMARY_PATH -v "${PWD}:/work" -w /work grafana/k6:2.1.0 run backend-rust/load-tests/k6/capacity.js
```

For the pool profile, raise `K6_POOL_RPS` in controlled steps. Stop increasing load after the first failed gate; the objective is to identify safe capacity, not to damage staging.

## Required proof artifact

A capacity sign-off must retain:

1. `k6-summary.json` from a passing baseline run.
2. `k6-summary.json` from the highest passing pool run and the first failing run.
3. AWS metrics for ALB p95/5xx, RDS connections/CPU/latency, Redis cache hit rate/connections/evictions.
4. RDS slow-query log results for the same UTC run window.
5. Environment metadata: image SHA, ECS task count/CPU/memory, RDS class, Redis class, branch count, dataset volume, VUs/RPS, duration, and AWS region.
6. RDS parameter evidence showing `log_min_duration_statement=500`; the collector fails closed if it is not configured.

The manual GitHub workflow runs the gate against protected staging variables and collects the correlated AWS evidence automatically.

## Known boundary

The current API has synchronous report/export responses and scheduled custom-report processing, but no on-demand `202 Accepted` large-export job contract with job status and download endpoints. Therefore the suite does not label a synchronous download as a background-job pass. That capability remains a separate implementation and benchmark item.

