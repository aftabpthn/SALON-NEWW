# DATABASE.md — Database Standards

> **Primary AI Role:** Database Architect
> **Status:** Living document. Extend, never rewrite (AGENTS.md Delete Safety Rule).

## 1. Purpose

Rules for all data modelling and SQL in AuraShine. The engine is **PostgreSQL**
via `DATABASE_URL`, managed by `sqlx`. PostgreSQL is the runtime source of truth in
current stack architecture.

## 2. Non-negotiable Rules

1. **Every tenant-owned table has `tenantId` and `branchId`** (TEXT), indexed.
2. **Columns are camelCase.** Tables follow existing naming in the schema.
3. **Named parameters only** — `@param` style. Positional `?` is forbidden.
4. **Money = integer paise** (INTEGER). No REAL/float money columns, ever.
5. **Dates/timestamps** stored as ISO-8601 TEXT; business dates computed in IST.
6. **SQL lives only in `backend-rust/src/repositories`**.
7. **New schema changes arrive via `backend-rust/migrations`** (never embed large schema logic in handlers).

## 3. Query Patterns

```js
// Read — always tenant + branch scoped
const rows = db.prepare(`
  SELECT id, clientId, totalPaise, createdAt
  FROM invoices
  WHERE tenantId = @tenantId AND branchId = @branchId AND businessDate = @date
`).all({ tenantId, branchId, date });

// Multi-write — always a transaction
const saveInvoice = db.transaction((invoice, payments) => {
  insertInvoice.run(invoice);
  for (const p of payments) insertPayment.run(p);
  insertJournalLines.run(...);
});
```

- Prepare statements once (module scope) and reuse.
- Batch lookups with `IN` lists built from named params or a join — no query-per-row loops.
- Reads that back reports come from ledger/truth tables, never ad-hoc counters.

## 4. Schema Evolution (Migrations)

- New file in `backend-rust/migrations`, sequential id, applied on startup; re-runs are no-ops.
- **Additive-first:** add tables/columns freely; renames/drops are destructive and require explicit approval (Delete Safety Rule) plus a rollback note.
- Every new table starts with: `id`, `tenantId`, `branchId`, `createdAt`, `updatedAt` (as applicable), and indexes on `(tenantId, branchId, <primary filter>)`.
- Backfill scripts are idempotent and batch in transactions.

## 5. Integrity & Truth Models

- **Ledger over counters:** payment status, wallet, loyalty points, package sessions and stock levels derive from immutable event/ledger rows; corrections are reversing entries.
- **Accounting:** `journalEntryLines` is the source of truth; every entry balances (Σdebit = Σcredit) in paise; `balanceSheetSnapshots` archival only (`docs/accounting.md`).
- **Idempotency:** schedulers and webhook processors key their writes (event id / batch id) so re-processing is a no-op.
- Uniqueness that matters (invoice number per tenant+branch, barcode per tenant, client phone per tenant) is enforced with unique indexes, not application checks alone.

## 6. Concurrency & Performance

- PostgreSQL concurrency + transaction scope: keep transactions short and
  index writes at tenant boundary.
- No long computation inside a transaction; prepare data first, then write.
- Index every `(tenantId, branchId, frequent-filter)` combination used by list endpoints; verify with `EXPLAIN QUERY PLAN` when adding heavy queries.
- Analytics/aggregation jobs write snapshot tables off-peak instead of scanning OLTP tables per request (`docs/analytics.md`).

## 7. Backup & Restore

- Use managed PostgreSQL backup tooling (platform snapshots or `pg_dump`) and
  follow `BACKUP_RECOVERY.md` plus `docs/restore.md`.

## 8. AI Instructions

- Copy the patterns in §3 exactly; if an existing repository already touches the table, extend it rather than creating a parallel one.
- Never write string-interpolated SQL; never omit tenant scope.
- New schema → migration file + repository functions + tests, in one change.

## 9. Acceptance Criteria

- No query in the codebase lacks tenant scoping on tenant-owned tables.
- No positional parameters, no float money columns.
- Startup migration checks and startup boot pass in the current codebase.

## 10. Future Roadmap

- Document the full ERD per domain in `docs/<domain>.md` files.
- Data archival strategy for multi-year tenants.

## 11. Table and Column Standards

Every new tenant-owned table starts with:

```sql
id TEXT PRIMARY KEY,
tenantId TEXT NOT NULL,
branchId TEXT NOT NULL,
createdAt TEXT NOT NULL,
updatedAt TEXT
```

Domain columns use camelCase. Money columns end with `Paise`. Date-only
business fields use `businessDate` in IST. Public identifiers are opaque strings,
not auto-increment integers.

## 12. Index, Key, and Constraint Strategy

- Primary lookup: `id`.
- Tenant lists: `(tenantId, branchId, createdAt)` or the domain's main filter.
- Unique business keys include tenant and branch where appropriate.
- Foreign keys stay enabled; app-level checks do not replace constraints.
- Add indexes with the query that needs them; verify heavy paths with
  `EXPLAIN QUERY PLAN`.

## 13. Accounting, Inventory, and Reporting Rules

- Accounting truth: `journalEntryLines`; every posting balances in paise.
- Inventory truth: stock movement/ledger rows; corrections use reversing rows.
- Reports read from truth tables or stored snapshots, never mutable dashboard
  counters.
- Month-end and scheduled jobs are idempotent by tenant, branch, and date.

## 14. Migration, Backup, Restore, and Archival

- Migrations are additive, sequential, idempotent, and safe to rerun.
- Backfills run in batches and can resume.
- Backups are created through online backup tooling.
- Restore runbooks must verify schema version, row counts, tenant isolation, and
  critical financial totals.
- Archival moves cold data out of hot paths without changing public contracts.

## 15. Future PostgreSQL Strategy

No persistence-engine migration is planned in this branch. If storage changes
are introduced, preserve camelCase contracts, paise money, tenant/branch scope,
repository interfaces, and migration history.
