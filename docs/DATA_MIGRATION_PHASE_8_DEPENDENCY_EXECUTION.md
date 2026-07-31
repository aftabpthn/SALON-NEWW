# Data Migration Phase 8: Dependency-Aware Execution

## Runtime contract

Phase 8 extends the existing PostgreSQL job, immutable-source, chunk lease and transactional batch pipeline. Jobs are grouped by tenant, branch and source hash; dependency edges cannot cross scope. The database trigger also rejects equal-rank, reverse-rank or cross-scope edges.

Execution rank:

1. Clients
2. Staff, services, products, suppliers
3. Memberships, packages, inventory
4. Client memberships, appointments
5. Sales, invoices
6. Payments, refunds
7. Loyalty, commissions, stock movements, files

Purchase bills and payroll run at rank 3, client notes at rank 4, expenses at rank 5, and gift cards at rank 6 because their existing repository contracts depend on the preceding master or financial domains.

## Pending and retry behavior

- Missing live references use row status `dependency_pending`; the source row and evidence remain stored.
- The job uses `dependency_pending` while an upstream job is incomplete.
- After all prerequisites complete, an immutable source job is re-staged once, so references are resolved against committed tenant/branch data.
- A new prerequisite edge resets the retry marker, allowing a later upstream job to release the child safely.
- Completed chunks are checkpoints. Lease expiry reclaims only processing chunks; retry resets only failed chunks.
- The existing source-hash uniqueness guard prevents a completed or active commit source from being submitted again.

The legacy inline-CSV API retains backward compatibility. It preserves missing-reference rows as `dependency_pending`, but automatic row revalidation requires immutable source evidence (`sourceFileId`); otherwise governance reports `DEPENDENCY_RETRY_REQUIRES_IMMUTABLE_SOURCE`. The CRM file-upload workflow already uses immutable evidence.

## Deadlock reporting

Governance and proof packs expose `dependencyExecution` with pending-row count and a stable deadlock object. Monitoring emits `MIGRATION_DEPENDENCY_DEADLOCK`.

Stable codes:

- `DEPENDENCY_PENDING`
- `DEPENDENCY_UPSTREAM_JOB_MISSING`
- `DEPENDENCY_UPSTREAM_TERMINAL`
- `DEPENDENCY_RETRY_REQUIRES_IMMUTABLE_SOURCE`
- `DEPENDENCY_DEADLOCK`

Deadlock transitions are recorded as `migration.dependencies.deadlock`; successful release and retry transitions use `migration.dependencies.released` and `migration.dependencies.retry_queued`.

## Transaction and idempotency boundaries

- Each child chunk commits in its own PostgreSQL transaction; a child rollback cannot roll back a completed parent job.
- Job/entity advisory locks serialize concurrent writes.
- Batch `(job_id, batch_number)`, chunk `(job_id, chunk_number)`, source identity and existing entity-specific import keys prevent duplicate writes.
- Chunk completion, row actions, batch completion and checkpoint counters commit atomically.
