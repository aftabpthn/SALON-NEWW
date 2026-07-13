# Data Migration Client Intake Pack

Date: 2026-06-24

## Purpose

Use this pack when an existing salon, spa, clinic, or franchise is moving from another software into AuraSalon. The goal is to receive clean export files, validate them safely, and import only after reconciliation and client sign-off.

## Client Handoff Requirements

Ask the client for exports from their current software:

- Clients and contacts
- Services, categories, staff pricing, branch pricing, and tax rules
- Products, variants, barcodes, suppliers, stock quantity, and stock value
- Memberships, packages, gift cards, coupons, and loyalty balances
- Appointments, bookings, invoices, payments, refunds, and credits
- Staff, roles, permissions, payroll references, and commission rules
- Branch list, register/counter list, and opening balances

Accepted formats:

- `.xlsx`
- `.xls`
- `.csv`

## Intake Controls

- Require tenant, branch, source software, export date, and exported-by user name.
- Keep the original export read-only.
- Never edit the client source file directly.
- Store the imported batch ID with every proof bundle.
- Confirm whether the client has multiple branches or franchise locations before mapping.

## Data Quality Questions

Before upload, confirm:

- Does the old software allow duplicate phone numbers?
- Are invoice numbers global or branch-wise?
- Are prices tax-inclusive or tax-exclusive?
- Are inventory values stored as purchase price, selling price, or weighted average?
- Are memberships/package balances active as of go-live date?
- Is there any data that should be archived instead of imported?

## Launch Flow

1. Collect source exports and branch details.
2. Upload files to the migration command center.
3. Run analysis and AI mapping.
4. Fix critical blockers and duplicate pressure.
5. Run dry run.
6. Reconcile old vs Aura totals.
7. Export proof bundle.
8. Get client sign-off.
9. Run final import.
10. Validate live modules with the client.

## Client Sign-Off Checklist

- Client records are searchable.
- Booking history is visible where imported.
- Services and products are mapped to correct categories.
- Invoice and payment totals match legacy reports.
- Stock quantity and value match legacy reports.
- Branch-level totals are correct.
- No critical migration blockers remain.

## Support Script

Use this short script with clients:

> We will not directly write into your live AuraSalon account first. We will upload your old software export, analyze it, run a dry import, compare totals, and only after your approval perform the final import. If something is wrong, we can stop before final import or roll back a completed migration batch.
