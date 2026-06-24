# Data Migration Production Deployment Checklist

Date: 2026-06-24

## Pre-Deployment

- Confirm tenant and branch headers are enforced for every migration API call.
- Confirm source exports include stable IDs, created dates, invoice numbers, payment references, and branch identifiers.
- Confirm sample files have passed analyze, dry run, reconciliation, and proof export.
- Confirm rollback coverage exists for the target batch.
- Confirm import cutoff window with the client so old software data does not change mid-import.

## Production Run

1. Create migration batch in sandbox mode.
2. Upload source files in chunks.
3. Run analyze and mapping confidence checks.
4. Resolve blockers before import.
5. Run dry run with reconciliation.
6. Export proof bundle and get client sign-off.
7. Run final import with partial import disabled unless explicitly approved.
8. Reconcile live clients, services, products, invoices, payments, inventory, and branch totals.
9. Keep rollback batch available until client confirms operational readiness.

## Go-Live Acceptance

- Client count matches source export.
- Invoice totals match source export in integer paise.
- Payment totals match invoice settlement reports.
- Inventory quantity and value match source export.
- Branch-level totals match legacy branch reports.
- Duplicate detection report is reviewed.
- Critical error count is zero.

## Post-Go-Live

- Keep legacy source export read-only for audit.
- Store proof bundle with tenant, branch, batch ID, and timestamp.
- Monitor first-day POS, invoice, booking, inventory, and client lookup activity.
- Schedule 24-hour and 7-day reconciliation checks.
