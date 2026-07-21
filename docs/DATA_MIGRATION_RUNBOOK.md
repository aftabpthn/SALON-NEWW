# Data Migration Production Runbook

## Monitor

Poll `GET /api/settings/integrations/import-monitoring` with an authenticated tenant and branch context. The response is tenant/branch scoped and exposes queue depth, stale workers, failures in the last 24 hours, overdue approvals, status counts, and active alerts.

| Alert | Threshold | Owner | Response |
| --- | --- | --- | --- |
| `MIGRATION_WORKER_STALE` | staging/processing heartbeat older than 5 minutes | Platform on-call | Critical |
| `MIGRATION_FAILURES` | one or more failed jobs in 24 hours | Migration owner | Warning |
| `MIGRATION_APPROVAL_OVERDUE` | owner approval pending over 30 minutes | Branch owner | Warning |
| `MIGRATION_QUEUE_DEPTH` | more than 20 staging/queued jobs | Platform on-call | Warning |

Do not log source rows, uploaded content, client data, or full failure payloads. Use job ID, tenant ID, branch ID, status, counts, heartbeat, and request ID only.

## Stale worker

1. Confirm the API and PostgreSQL health checks.
2. Inspect the job heartbeat, worker phase, queue depth, and latest structured worker warning.
3. Restart only the migration worker process when the API is healthy but heartbeats remain stale.
4. Use `retry-failed` only after verifying the source/chunk checksum. Do not bypass `FOR UPDATE SKIP LOCKED` claiming or edit staging rows manually.

## Failed job

1. Open the governance report and call `POST /api/settings/integrations/import-jobs/:id/failure-assistant`.
2. Export failed rows and the proof pack. Keep the original source evidence read-only.
3. Correct the source and run a new dry-run. For chunk failures, use `retry-failed` after the reported cause is fixed.
4. If reconciliation differs, calculate rollback impact before rollback. Never delete target, journal, inventory, or ID-mapping rows manually.

## Approval overdue

Verify the assigned owner still has branch access. The assigned owner must approve or reject the exact job; do not reassign or bypass approval to clear the alert.

## Queue backlog

Check stale workers and database pool saturation first. Pause new uploads if queue depth continues to grow. Scale worker replicas only when all workers use the existing lease and `SKIP LOCKED` claim contract.

## AI degradation

`POST /api/settings/integrations/import-mapping-suggestions` and the failure assistant call the Python AI service when configured. Missing credentials, provider errors, timeouts, invalid model output, or unavailable AI service automatically return deterministic Rust/Python policy results. Imports never depend on model availability.

## Release checks

```powershell
cd ai-service
python -m unittest test_customer_ai.py

cd ..\backend-rust
cargo test migration_file_service::tests
cargo test migration_repository::tests
cargo check
```

For the release stress gate, keep at least twice the largest expected source file on the migration storage volume and run a dry-run through upload, staging, reconciliation, proof-pack export, and rollback preflight.
