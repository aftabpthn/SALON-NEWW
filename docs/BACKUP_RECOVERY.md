# BACKUP_RECOVERY.md — Backup & Recovery Policy

> **Primary AI Role:** DevOps Engineer
> **Status:** Living document. Procedures: `docs/backup.md` (taking), `docs/restore.md` (restoring).

## 1. Purpose

The policy that guarantees AuraShine tenant data survives disk loss, corruption,
bad deploys and operator error. Salon businesses run on this data — losing a
tenant’s books is an existential failure.

## 2. Objectives

| Metric | Target |
| --- | --- |
| RPO (max data loss) | ≤ 24 hours (scheduled) / ≤ few minutes with pre-deploy + on-demand backups around risky events |
| RTO (max downtime to restore) | ≤ 1 hour from declaring the incident |
| Verification | Every backup checksummed; monthly restore drill mandatory |

## 3. What Is Backed Up

1. **PostgreSQL database** (`DATABASE_URL`) — via managed PostgreSQL backup tooling (`pg_dump`, WAL/base backups, and restore-tested snapshots), plus optional PostgreSQL WAL retention for near-RPO recovery.
2. **Uploaded files** (logos, consent forms, captures) — same cadence.
3. **Configuration** — `.env` values stored in the secrets manager of the host (never inside backup archives in plaintext).

## 4. Schedule & Retention

- **Daily** automated backup (retain 14), **weekly** (retain 8), **monthly** (retain 12).
- **Event-driven:** before every deploy containing migrations, and before any approved destructive operation.
- Copies: local + encrypted offsite. Encryption mandatory; keys managed outside the backup store.

## 5. Verification

- Post-backup: checksum recorded and compared on copy.
- **Monthly drill:** restore latest backup to a scratch PostgreSQL instance → run integrity checks + API health checks (`/api/health`) → sample tenant spot-check → drill logged.
- A backup that has never been restored is treated as nonexistent.

## 6. Recovery Decision Tree (summary — full steps in docs/restore.md)

1. Corruption/disk loss → stop API writes → restore latest verified backup → integrity check → smoke tests → reopen → post-mortem.
2. Bad deploy without destructive migration → rollback image only (DEPLOYMENT.md §6), no restore needed.
3. Single-tenant logical damage (bad import, operator error) → prefer targeted repair via import-batch undo (docs/migration.md) before whole-database restore.

## 7. Alerting

- Missed/failed backup alerts within 5 minutes (docs/monitoring.md).
- Backup age exposed as a monitored metric; > 24h is page-worthy.

## 8. AI Instructions

- Never write a script that deletes or overwrites backups (Delete Safety Rule applies doubly here).
- Changes to backup scripts are verified by an actual backup + restore in scratch, not by reading code.
- Never store secrets or unencrypted archives offsite.

## 9. Acceptance Criteria

- A backup ≤ 24h old always exists and is checksummed.
- Monthly drills logged and passing; RTO/RPO met in drills.
- Every restore in production is followed by a post-mortem entry.

## 10. Future Roadmap

- Per-tenant logical export for granular restore.
- Continuous PostgreSQL WAL shipping/replication to shrink RPO toward minutes.
