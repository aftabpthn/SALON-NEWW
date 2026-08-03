# SCHEMA_MIGRATION_SAFETY.md — Migrating Without Freezing the Floor

> **Status:** Living document. Applies to every file added under `backend-rust/migrations/`.

## 1. Why this exists

At 1000 live salons, a migration is not a schema change — it is a production
incident waiting for a lock. A plain `ALTER TABLE` or `CREATE INDEX` takes an
`ACCESS EXCLUSIVE` lock, and while that lock is held **no invoice can be
written and no appointment can be booked** on that table. It does not look like
an outage in the logs; it looks like the software hanging at the reception desk.

The rules below exist so that never happens during business hours.

## 2. Who applies migrations

Migrations are applied by **one dedicated task, before the serving tasks are
touched**:

| Stage | What runs | Where |
| --- | --- | --- |
| 1 | `aura-shine-backend --migrate-only` | `aws_ecs_task_definition.migration` |
| 2 | `aws ecs update-service` (rolling deploy) | `aws_ecs_service.app` |

Serving tasks run with `RUN_MIGRATIONS_ON_BOOT=false`. This is not optional. If
every replica migrates on boot, they all serialise behind the same advisory lock
before they can pass a health check, and the deploy either crawls or trips the
deployment circuit breaker.

`--migrate-only` always migrates, regardless of `RUN_MIGRATIONS_ON_BOOT`, so the
dedicated task cannot be accidentally disabled by configuration.

Locally, `docker compose up` runs the same two stages: the `migrate` service
must exit successfully before `api` starts.

## 3. The five rules

### Rule 1 — Never rename or drop a column in the same release that stops using it

During a rolling deploy the old and new binaries run **at the same time**. A
column the old code still reads cannot disappear.

```
Release 1:  add new column (nullable, no default scan) → write both → backfill
Release 2:  read new only
Release 3:  drop old column
```

This is the expand → migrate → contract pattern. Three releases is the cost of
not taking the site down.

### Rule 2 — Every index is built `CONCURRENTLY`

```sql
-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_tenant_branch_start
  ON appointments(tenant_id, branch_id, start_at);
```

The `-- no-transaction` marker on the first line is **required**: SQLx wraps each
migration in a transaction by default, and `CONCURRENTLY` cannot run inside one.

`CONCURRENTLY` trades a slower build for not blocking writes. On a table holding
1000 salons' appointments, that trade is never close.

Note that a failed concurrent build leaves an invalid index behind. Check for one
before retrying:

```sql
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
```

### Rule 3 — Bound how long a migration will wait for a lock

Put this at the top of any migration that touches an existing table:

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
```

Without `lock_timeout`, a migration that cannot get its lock **queues behind the
current query and blocks every query that arrives after it**. One slow report
turns into a site-wide freeze. With it, the migration fails fast and the deploy
stops — which is the outcome you want at 4am.

### Rule 4 — Backfill in batches, never in one `UPDATE`

A single `UPDATE` over a large table holds row locks for its whole duration and
bloats WAL.

```sql
-- Repeat until zero rows are affected; run from a job, not inside the migration.
UPDATE appointments
SET new_column = old_column
WHERE id IN (
  SELECT id FROM appointments WHERE new_column IS NULL LIMIT 5000
);
```

Large backfills belong in a worker or a one-off task, not in the migration that
adds the column. The migration should be fast enough that its lock is invisible.

### Rule 5 — Deploy when the salons are closed

Indian salon traffic peaks 11:00–21:00 IST. Schema changes go out **03:00–05:00
IST**. A migration that is safe by these rules still competes for I/O.

## 4. Operations that are safe vs unsafe

| Operation | Safe? | Notes |
| --- | --- | --- |
| `ADD COLUMN` (nullable, no default) | ✅ | Metadata-only |
| `ADD COLUMN ... DEFAULT <constant>` | ✅ | PG 11+ stores the default in the catalog |
| `ADD COLUMN ... DEFAULT <volatile>` | ❌ | Rewrites the whole table |
| `DROP COLUMN` | ✅ *lock-wise* | Metadata-only, but breaks Rule 1 if code still reads it |
| `CREATE INDEX` | ❌ | Blocks writes — use `CONCURRENTLY` |
| `DROP INDEX` | ❌ | Use `DROP INDEX CONCURRENTLY` |
| `ALTER COLUMN TYPE` | ❌ | Full rewrite; add a new column instead |
| `SET NOT NULL` | ❌ | Full scan; add a `NOT VALID` CHECK, then `VALIDATE CONSTRAINT` |
| `ADD FOREIGN KEY` | ❌ | Add with `NOT VALID`, then `VALIDATE CONSTRAINT` separately |
| `CREATE TABLE` | ✅ | Nothing to contend with |

## 5. Checklist before merging a migration

- [ ] Does it rename or drop something the currently-deployed binary still uses?
- [ ] Does every `CREATE INDEX` / `DROP INDEX` say `CONCURRENTLY`, with
      `-- no-transaction` on line 1?
- [ ] Does it set `lock_timeout` if it touches an existing table?
- [ ] Is any backfill batched and outside the migration?
- [ ] Has it been run against a production-sized copy, with the duration recorded?
- [ ] Is the change reversible, or is there a documented forward fix?

## 6. Known debt

The 360 migrations that predate this document use plain `ALTER TABLE` and plain
`CREATE INDEX`: `CONCURRENTLY` appears 0 times, `-- no-transaction` 0 times, and
`ALTER TABLE` 655 times. They are already applied, so they are not a live risk —
but they are not examples to copy. Follow this document, not the surrounding
files.

## 7. Related

- `docs/DEPLOYMENT.md` — deploy stages and rollback
- `docs/DATABASE.md` — schema conventions
- `docs/OBSERVABILITY.md` — what to watch during a migration window
