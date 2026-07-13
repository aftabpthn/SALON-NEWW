# Runbook

## Purpose
Single entrypoint index for operational and recovery documentation.

## Action Status

- **done**: Operational index and one-click command lists are standardized for deploy/db/payment incident types.
- **in-progress**: Final cleanup of placeholder commands with production-safe command variants for mixed local/cloud environments.
- **blocker**: None.

## Operations
- [Deployment](../DEPLOYMENT.md)
- [Deployment Guide](../DEPLOYMENT_GUIDE.md)
- [Deployment Runbook](../deployment.md)
- [Release Process](../release-process.md)
- [Backup](../backup.md)
- [Backup Recovery](../../BACKUP_RECOVERY.md)
- [Restore](../restore.md)

## Monitoring
- [Observability](../../OBSERVABILITY.md)
- [Monitoring](../monitoring.md)
- [Troubleshooting](../troubleshooting.md)

## Incident Playbooks

### Deployment Incident
- Check health and rollback status:
  - `GET /health` and related service logs
  - Last successful deploy hash / migration status
- If API is unhealthy, perform quick rollback to last stable build.
- Verify static assets/build and CDN cache (if any), then restart only affected services after rollback/patch.
- Re-run smoke routes and alert channel notification templates.

**Copy-ready (paste exactly)**
```powershell
curl http://127.0.0.1:4000/health
curl -H "Authorization: Bearer <JWT_TOKEN>" http://127.0.0.1:4000/api/v1/deployment/summary
git log --oneline --decorate --graph -n 8
git checkout <LAST_GOOD_COMMIT>
npm run api
curl -X POST http://127.0.0.1:4000/api/v1/deployment/events -H "Authorization: Bearer <JWT_TOKEN>" -H "Content-Type: application/json" -d '{ "type":"rollback","status":"started","environment":"production","version":"<LAST_GOOD_COMMIT>","result":{"incident":"deploy"} }'
```

**One-click command list**
```powershell
# 1) Health + process check
curl http://127.0.0.1:4000/health
Get-Process node | Where-Object { $_.ProcessName -eq "node" }

# 2) Deployment rollout state (no local assumptions)
curl -H "Authorization: Bearer <JWT_TOKEN>" http://127.0.0.1:4000/api/v1/deployment/summary

# 3) Quick rollback (replace <LAST_GOOD_COMMIT> with proven hash/tag)
git log --oneline --decorate --graph -n 8
git checkout <LAST_GOOD_COMMIT>
npm run api

# 4) Record rollback event
curl -X POST http://127.0.0.1:4000/api/v1/deployment/events `
  -H "Authorization: Bearer <JWT_TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{ "type":"rollback","status":"started","environment":"production","version":"<LAST_GOOD_COMMIT>","result":{"incident":"deploy"} }'
```

### Database Incident
- Confirm DB lock/write contention:
  - check recent migration status and long-running write transactions.
- Validate tenant/branch scoped filters for affected queries (quickly verify sample route with same tenant headers).
- If corruption signs appear, prioritize read-only triage + backup recovery checklist, then escalate.
- Keep an audit of changed rows/tables for incident notes.

**Copy-ready (paste exactly)**
```powershell
curl http://127.0.0.1:4000/api/v1/admin/schema-health
npm run backup:db
curl -X POST http://127.0.0.1:4000/api/v1/security/backups -H "Authorization: Bearer <JWT_TOKEN>" -H "Content-Type: application/json" -d '{ "type":"incident","reason":"database-incident","environment":"production" }'
curl -H "Authorization: Bearer <JWT_TOKEN>" "http://127.0.0.1:4000/api/v1/security/backups"
```

**One-click command list**
```powershell
# 1) DB schema and lock health
curl http://127.0.0.1:4000/api/v1/admin/schema-health
Get-Process node | Select-Object Id, ProcessName, WorkingSet, CPU

# 2) Take immediate DB backup
npm run backup:db
curl -X POST http://127.0.0.1:4000/api/v1/security/backups `
  -H "Authorization: Bearer <JWT_TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{ "type":"incident","reason":"database-incident","environment":"production" }'

# 3) Read recent backup restore-drill status
curl -H "Authorization: Bearer <JWT_TOKEN>" "http://127.0.0.1:4000/api/v1/security/backups"
```

### Payment Incident
- Verify payment provider status and webhook callback health.
- Check transaction idempotency/retry path for duplicate settlements.
- Ensure API token scope and signature keys are current in environment.
- Pause non-critical checkout campaigns if error rate exceeds threshold, then route retries with backoff.

**Copy-ready (paste exactly)**
```powershell
curl http://127.0.0.1:4000/api/v1/health
curl -X POST http://127.0.0.1:4000/api/v1/payments/webhooks/razorpay -H "x-razorpay-signature: <X_RAZORPAY_SIGNATURE>" -H "Content-Type: application/json" --data-binary "@<PAYLOAD_FILE>.json"
Get-ChildItem -Path .\server -Recurse -Filter *.log | Sort-Object LastWriteTime -Descending | Select-Object -First 5 -ExpandProperty FullName | ForEach-Object { Get-Content $_ -Tail 120 } | Select-String -Pattern "payment|webhook|signature|idempotent"
```

**One-click command list**
```powershell
# 1) Check payment provider callbacks are reachable
curl http://127.0.0.1:4000/api/v1/health

# 2) Replay payment webhook payload from incident log
curl -X POST http://127.0.0.1:4000/api/v1/payments/webhooks/razorpay `
  -H "x-razorpay-signature: <X_RAZORPAY_SIGNATURE>" `
  -H "Content-Type: application/json" `
  --data-binary "@<PAYLOAD_FILE>.json"

# 3) Verify recent payment failures
Get-ChildItem -Path .\server -Recurse -Filter *.log |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 -ExpandProperty FullName |
  ForEach-Object { Get-Content $_ -Tail 120 } |
  Select-String -Pattern "payment|webhook|signature|idempotent"
```

### Auth / Access Incident
- Confirm identity service and session store are healthy.
- Invalidate suspect sessions if token theft/leak suspected; rotate refresh secrets if required.
- Check role/tenant headers on impacted routes (`x-tenant-id`, `x-branch-id`, `x-user-role`).
- Review recent permission-policy commits before any emergency fix.

**Copy-ready (paste exactly)**
```powershell
curl http://127.0.0.1:4000/api/v1/health
curl -H "Authorization: Bearer <JWT_TOKEN>" -H "x-tenant-id: <TENANT_ID>" -H "x-branch-id: <BRANCH_ID>" -H "x-user-role: admin" http://127.0.0.1:4000/api/v1/auth/me
curl -X PATCH "http://127.0.0.1:4000/api/v1/security/sessions/<SESSION_ID>/revoke" -H "Authorization: Bearer <JWT_TOKEN>"
```

**One-click command list**
```powershell
# 1) Validate auth and session service is up
curl http://127.0.0.1:4000/api/v1/health

# 2) Verify tenant/branch scoped auth behavior
curl -H "Authorization: Bearer <JWT_TOKEN>" -H "x-tenant-id: <TENANT_ID>" -H "x-branch-id: <BRANCH_ID>" -H "x-user-role: admin" `
  http://127.0.0.1:4000/api/v1/auth/me

# 3) Revoke suspicious session token (on-call only, coordinate first)
curl -X PATCH "http://127.0.0.1:4000/api/v1/security/sessions/<SESSION_ID>/revoke" `
  -H "Authorization: Bearer <JWT_TOKEN>"

# 4) Force secret reload note
# Set-Item -Path Env:JWT_REFRESH_SECRET -Value "<NEW_SECRET>"
# Restart API service after rotating secrets in your deployment system
```

### Backup / Restore Incident
- Locate latest verified backup timestamp and associated restore test status.
- Validate backup integrity before any overwrite attempt.
- Execute restore in staging first; compare tenant sample counts before production restore.
- Record RTO/RPO achieved and post-incident actions (owner, root cause, prevention).

**Copy-ready (paste exactly)**
```powershell
npm run backup:db
curl -X POST http://127.0.0.1:4000/api/v1/security/backups -H "Authorization: Bearer <JWT_TOKEN>" -H "Content-Type: application/json" -d '{ "type":"incident","reason":"incident","environment":"production" }'
Get-ChildItem -Path .\server -Recurse -Filter "*.db" | Where-Object { $_.FullName -match "\\backups\\" } | Sort-Object LastWriteTime -Descending | Select-Object -First 20 FullName, LastWriteTime, Length
curl -X POST "http://127.0.0.1:4000/api/v1/security/backups/<BACKUP_ID>/verify-restore" -H "Authorization: Bearer <JWT_TOKEN>" -H "Content-Type: application/json" -d '{ "reason":"restore-drill" }'
```

**One-click command list**
```powershell
# 1) Take and timestamped backup
npm run backup:db
curl -X POST http://127.0.0.1:4000/api/v1/security/backups `
  -H "Authorization: Bearer <JWT_TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{ "type":"incident","reason":"incident","environment":"production" }'

# 2) Verify backup file list
Get-ChildItem -Path .\server -Recurse -Filter "*.db" |
  Where-Object { $_.FullName -match "\\backups\\" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 20 FullName, LastWriteTime, Length

# 3) Restore drill in environment
curl -X POST "http://127.0.0.1:4000/api/v1/security/backups/<BACKUP_ID>/verify-restore" `
  -H "Authorization: Bearer <JWT_TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{ "reason":"restore-drill" }'

# 4) Restore path decision
# node scripts/restore-database.mjs --source "<BACKUP_FILE_PATH>" --target "<TARGET_DB_PATH>"
```

## References
- [Health check](http://127.0.0.1:4000/health)
- [Frontend](http://127.0.0.1:4300)

## Notes
Use this index before on-call incidents to jump to one place, then follow environment-specific runbook steps.

## Placeholder Source Guide

- `<JWT_TOKEN>`: get from any currently logged-in admin session API call.
  - easiest: browser/dev-tools Network tab → request with `Authorization: Bearer ...` header, copy token.
  - fallback: call login endpoint once and reuse returned token:
    - `POST /api/v1/auth/login` (capture `accessToken` from response)

- `<LAST_GOOD_COMMIT>`: get from git history/release notes.
  - `git log --oneline --decorate --graph -n 20`
  - optionally pin to `git tag` that matched the last successful deployment

- `<BACKUP_ID>`: get from latest backup list.
  - `curl -H "Authorization: Bearer <JWT_TOKEN>" "http://127.0.0.1:4000/api/v1/security/backups"`
  - use the most recent id from response (or backup id from incident snapshot)

- `<PAYLOAD_FILE>.json`: raw webhook event body captured at failure time.
  - save the exact provider payload from provider logs / webhook delivery logs
  - keep tenant/branch identifiers plus signature headers aligned to the replay command
- `<X_RAZORPAY_SIGNATURE>`: header value from payment provider webhook delivery.
- `<TENANT_ID>`: tenant id used in tenant-scoped runtime checks.
- `<BRANCH_ID>`: branch id used in tenant-scoped runtime checks.
- `<SESSION_ID>`: session identifier for targeted session revocation.
- `<NEW_SECRET>`: new JWT refresh secret value used only during emergency rotation.
- `<BACKUP_FILE_PATH>`: source backup path used for restore.
- `<TARGET_DB_PATH>`: target DB path used by restore command.
