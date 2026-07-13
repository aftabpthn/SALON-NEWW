# Data Migration Go-Live Rehearsal

Date: 2026-06-24

## Goal

Run one full rehearsal before a production migration so the team proves backup, import, reconciliation, rollback, and client validation.

## Rehearsal Steps

1. Confirm source export cutoff time.
2. Confirm AuraSalon tenant and branch setup.
3. Create migration batch.
4. Upload all source files.
5. Run analyze.
6. Save mapping profile.
7. Run dry run.
8. Export validation report.
9. Reconcile totals.
10. Export proof bundle.
11. Perform rollback rehearsal if the environment allows it.
12. Record timing for each step.
13. Confirm support owner for go-live day.

## Acceptance Criteria

- Critical blockers are zero.
- Reconciliation totals are signed off.
- Rollback path is verified.
- Proof bundle is stored.
- Support owner is assigned.
- Client has approved final import timing.

## Smoke Test After Final Import

- Search imported client by phone.
- Open imported invoice.
- Confirm linked payment.
- Confirm product stock quantity.
- Create a new booking.
- Create a new POS sale.
- Confirm reports include imported opening data.
