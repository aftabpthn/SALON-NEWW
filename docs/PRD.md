# PRD.md - AuraShine CRM Rust

## Purpose

AuraShine is a multi-tenant salon CRM/POS platform for real salon operations:
appointments, POS billing, clients, staff, inventory, finance, reports, and
branch control.

## Target Users

- Owner: revenue, branch performance, permissions, subscriptions, audit.
- Manager: appointments, staff, reports, inventory, daily operations.
- Reception/front desk: bookings, check-in, POS, client lookup, cash drawer.
- Staff: roster, appointments, attendance, payroll, feedback.
- Accountant: reports, tax, ledger, payouts, expenses, reconciliation.
- Inventory user: stock, suppliers, purchases, consumption, expiry.

## Product Scope

- Angular frontend in `frontend-angular/`.
- Rust Axum API in `backend-rust/`.
- PostgreSQL as durable CRM truth.
- Redis for cache, locks, queues, and sessions only.
- Python AI service for assisted analytics and messaging, not core writes.

## Core Features

- Appointment calendar with staff, branch, waitlist, blocks, and status flows.
- POS invoices with services, products, split payments, taxes, refunds, and audit.
- Client CRM with visit history, memberships, packages, wallet, consent, notes.
- Staff management with profiles, attendance, payroll, commissions, app access.
- Inventory with products, stock ledger, purchase bills, suppliers, backbar usage.
- Finance and reports backed by persisted ledger/source rows.
- RBAC, tenant/branch isolation, audit logs, and realtime updates.

## Non-Negotiables

- No dummy business data in production code.
- Money uses integer paise.
- Every tenant-owned read/write is tenant scoped and branch scoped where relevant.
- Backend owns validation, permissions, and business decisions.
- Frontend reloads API-backed data after create/update/delete/action flows.
- Applied migrations are never edited; add a new sequential migration.

## Acceptance

A feature is ready only when the API contract, persisted data, UI wiring,
permissions, error handling, and smallest useful verification are complete.
