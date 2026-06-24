# Data Migration Monitoring And Alerts

Date: 2026-06-24

## Goal

Track large imports across lakhs and crores of records with enough visibility to detect slow chunks, failed rows, reconciliation mismatches, and rollback activity.

## Metrics To Capture

- Batch ID
- Tenant ID
- Branch ID
- Source software
- Uploaded file count
- Rows scanned
- Rows valid
- Rows failed
- Critical error count
- Warning count
- Duplicate count
- Chunk count
- Average chunk duration
- Slowest chunk duration
- Dry-run duration
- Final import duration
- Rollback batch count
- Proof export timestamp

## Alert Rules

- Critical errors greater than zero: block final import.
- Failed row ratio above 1 percent: require migration owner review.
- Chunk duration above expected threshold: flag performance risk.
- Payment total mismatch: block final import.
- Invoice total mismatch: block final import.
- Inventory value mismatch: require finance sign-off.
- Rollback executed: notify support owner and tenant admin.

## Operational Dashboard

The migration dashboard should show:

- Active batches
- Current step
- Progress percentage
- Latest chunk status
- Critical blockers
- Reconciliation status
- Rollback readiness
- Last proof export

## Support Response

When an alert fires:

1. Pause final import.
2. Export current validation report.
3. Identify affected entity and source file.
4. Fix mapping or source data issue.
5. Re-run dry run.
6. Reconcile again.
7. Resume only after the blocker is cleared.
