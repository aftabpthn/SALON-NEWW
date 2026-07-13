# Data Migration Launch Checklist

Use this checklist before moving an existing salon, spa, clinic, barber, or franchise client from legacy software into AuraSalon Enterprise v1.

## 1. Client Intake

- Confirm tenant, branch, franchise, and role scope.
- Collect source software name, export format, file count, and expected record totals.
- Capture required modules: clients, staff, services, products, inventory, appointments, invoices, payments, memberships, packages, loyalty, and marketing history.
- Ask for legacy IDs to be preserved for all relationship-heavy entities.
- Confirm business date timezone is IST unless the deployment has an approved override.

## 2. Source File Controls

- Accept `.xlsx`, `.xls`, or `.csv` only.
- Keep raw source files unchanged for audit proof.
- For large CSV files, use chunk staging instead of browser full-file import.
- Verify chunk checksums are generated and unchanged before import.
- Reject changed chunks unless a new migration job is created.

## 3. Mapping And Validation

- Run Analyze first and review required fields.
- Resolve critical errors before final import.
- Review warning rows, duplicate rows, and branch coverage.
- Confirm parent entities are migrated before child entities:
  - clients, staff, services, products, vendors
  - appointments, inventory, sales, invoices, payments
- Verify payment rows map to invoices through invoice ID, invoice number, bill ID, or receipt invoice fields.

## 4. Approval Gate

- Submit owner approval after Analyze and Dry Run.
- Keep approval note tied to tenant, branch, resource, and summary counts.
- Do not run live import without approval unless the operator explicitly uses an approved emergency bypass.
- For pending chunks, keep partial import disabled unless the client signs off on importing only ready chunks.

## 5. Large Migration Runbook

- Stage CSV chunks from the command center.
- Confirm ready chunk count equals total chunks.
- Queue worker with a conservative chunk-per-tick value first.
- Monitor worker status, heartbeat, failed chunks, and skipped rows.
- Retry failed chunks only after reviewing recovery output.
- Never re-stage imported chunks; create a new job or rollback first.

## 6. Reconciliation Proof

- Run proof check after import.
- Export migration proof JSON from the command center.
- Verify proof contains:
  - job totals
  - chunk manifest with checksum and status
  - reconciliation snapshot
  - id-map coverage
  - differences or warnings
- Attach proof file to client sign-off notes.

## 7. Rollback Readiness

- Confirm rollback cover exists for every import batch.
- Export failed-row report before rollback if errors exist.
- Rollback only the affected job or batch scope.
- Re-run reconciliation after rollback.

## 8. Production Sign-Off

- Spot-check live modules: Clients, Calendar, POS, Invoices, Payments, Products, Inventory, Memberships, Reports.
- Confirm branch totals match source expectations.
- Confirm payment balances and invoice statuses are correct.
- Confirm no critical recovery blockers remain.
- Get written sign-off from owner/operator before opening the tenant for daily use.

## 9. Post-Go-Live Watch

- Monitor imports, bookings, payments, invoice activity, inventory movement, and staff access for the first business day.
- Keep rollback proof and source files archived.
- Capture client-reported mismatches as recovery tasks, not direct database edits.