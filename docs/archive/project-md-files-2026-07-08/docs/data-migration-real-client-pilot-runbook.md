# Data Migration Real Client Pilot Runbook

Date: 2026-06-24

## Action Status

- **done**: Pilot scope, entry criteria, tiered data volumes, execution flow, reconciliation targets, and blocker conditions are fully documented.
- **in-progress**: None.
- **blocker**: Production dry-run reconciliation at full historical scale needs one more client-level validation cycle.

## Evidence Attachments

- **Ticket IDs**: `TKT-MIG-PILOT-2026-07-01` (pilot readiness), `TKT-MIG-PILOT-2026-07-02` (pilot closeout)
- **Proof bundle hash**: `proof-bundles/data-migration-real-client-pilot-evidence-2026-07.json` → `sha256:7c12172bcfced45064fa52d29576a4167ea402f21ff862e5cc410c9f23b65bd1`
- **Attachment workflow**: Save proof bundle hash + both ticket IDs in pilot completion packet before final client import approval.

## Goal

Run the first real client migration without risking live production data. This phase proves that AuraSalon can safely ingest large legacy exports, reconcile business totals, and get client approval before final import.

## Pilot Entry Criteria

- Client has confirmed old software name and export date.
- Client has exported clients, services, products, inventory, invoices, payments, bookings, memberships, packages, gift cards, coupons, staff, and branches where available.
- All files are original exports, not manually edited spreadsheets.
- Tenant and branch IDs are confirmed.
- Go-live cutoff window is confirmed.

## Pilot Data Limits

Use these pilot tiers before crore-scale import:

- Tier 1: 1,000 rows per entity for mapping validation.
- Tier 2: 25,000 rows for chunk performance validation.
- Tier 3: Full export dry run after Tier 1 and Tier 2 pass.

Do not run final import until full export dry run has zero critical blockers.

## Execution Flow

1. Create a migration batch for the client tenant.
2. Upload files in their original format.
3. Run analyze and review detected entities.
4. Save mapping profile after field confidence is approved.
5. Run Tier 1 dry run.
6. Fix mapping, duplicate, tax, branch, and invoice reference issues.
7. Run Tier 2 dry run.
8. Review chunk manifest, failed rows, and performance timing.
9. Run full export dry run.
10. Export proof bundle.
11. Get written client sign-off.
12. Run final import only after approval.

## Reconciliation Targets

The pilot passes only when these match the old software reports:

- Total clients by branch
- Active services and category counts
- Product SKU/barcode counts
- Inventory quantity and stock value
- Invoice count and invoice total in paise
- Payment count and payment total in paise
- Outstanding balances
- Membership/package/gift card balances
- Booking count by date range and branch

## Blocker Rules

Stop the pilot if any of these occur:

- Critical validation errors are greater than zero.
- Invoice total mismatch is greater than agreed tolerance.
- Payment total mismatch is greater than agreed tolerance.
- Branch assignment is missing for multi-branch data.
- Product stock value cannot be reconciled.
- Rollback proof is missing.

## Client Sign-Off Message

Use this wording before final import:

> We have completed the dry run using your exported data. The reconciliation proof bundle is ready with client, invoice, payment, product, inventory, and branch totals. Please approve final import only after checking the attached totals against your old software reports.

## Production Readiness Exit Criteria

- Full export dry run completed.
- Proof bundle exported and stored.
- Client sign-off captured.
- Rollback batch verified.
- Final import window scheduled.
- Support owner assigned for first 24 hours after go-live.
