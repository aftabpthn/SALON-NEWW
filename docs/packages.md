# Packages

## Purpose

Packages sell prepaid service credits, preserve their original monetary value, and redeem them through POS without mutable balance calculations.

## Architecture

- Angular workspace: `frontend-angular/src/app/pages/packages/`
- Axum routes: `backend-rust/src/routes/packages.rs`
- Business rules: `backend-rust/src/services/package_service.rs`
- PostgreSQL access: `backend-rust/src/repositories/packages_repository.rs`
- POS sale and redemption: `backend-rust/src/routes/pos.rs`
- Schema: migrations `0057_package_enterprise_completion.sql` and `0058_package_credit_value_ledger.sql`

PostgreSQL is the durable source of truth. Package balances are derived from issued credits minus immutable redemption ledger entries.

## Workflow

1. Create a package with service quantities, paid/free sessions, price, validity and visibility.
2. POS sale creates service credit rows with immutable `unit_value_paise` and `issued_value_paise` snapshots.
3. POS redemption appends a `pos_package_redemptions` row; it does not rewrite historical value.
4. Unified reports derive pending, expired and completed status from the same ledger.

## APIs

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET/POST` | `/packages` | List and create definitions |
| `GET/PATCH/DELETE` | `/packages/:id` | Read, update and delete a definition |
| `GET/PATCH` | `/package-enterprise/settings` | Package business settings |
| `GET` | `/package-enterprise/reports?status=pending\|expired\|completed` | Unified credit report |
| `GET` | `/package-enterprise/reports/export?status=...&format=csv\|pdf` | Report export |

All endpoints require authenticated tenant and branch context.

## Frontend

`/packages` contains Catalog, Active Credits, Pending, Expired, Completed and Settings. All mutations reload API-backed state. Empty databases show `No records yet`; the UI never creates sample package data.

Legacy report URLs redirect into the matching workspace tab:

- `/reports/pending-packages` → `/packages?tab=pending`
- `/reports/expired-packages` → `/packages?tab=expired`
- `/reports/completed-packages` → `/packages?tab=completed`

## Connected modules

- POS sells packages and memberships, assigns client credits, and records redemptions with the selected staff member.
- Invoice detail and PDF show membership/package sale lines and the client's current benefits.
- Client 360 reads active memberships, package credits, membership credits, expiry and balances from live APIs.
- Staff configuration reads active membership/package catalog items and stores per-item assignment and commission rules.

## Invariants

- Money is stored and calculated in integer paise.
- Every durable row is tenant and branch scoped.
- Service quantity must be positive; prices and validity cannot be negative.
- Credit and redemption value snapshots are immutable.
- Pending value is derived from ledger entries, never maintained as a free-standing total.
- Expiry and partial redemption follow saved package settings.

## Verification

```powershell
cd frontend-angular
npm run build

cd ..\backend-rust
cargo test package_service::tests
cargo test invoice_pdf::tests
cargo check
```
