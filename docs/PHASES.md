# PHASES.md - AuraShine CRM Rust Delivery Phases

## Purpose

Use phases to ship one complete slice at a time. Do not skip into later work
until the active phase is verified or explicitly paused.

## Phase 1 - Core Runtime

- Backend health, config, database, Redis, auth/session, tenant resolution.
- Angular shell, routing, guards, API client, i18n, shared date picker.

## Phase 2 - Front Desk Operations

- Appointments, booking flows, client lookup, staff assignment, waitlist, blocks.
- Realtime calendar refresh and automatic reload after actions.

## Phase 3 - POS And Payments

- Invoice creation, held invoices, split payments, refunds, cash drawer.
- Journal-backed totals, paise math, branch business date, audit history.

## Phase 4 - CRM And Memberships

- Client 360, memberships, packages, wallet, loyalty, retention, consent records.

## Phase 5 - Staff And Payroll

- Staff profiles, deputation, attendance, leave, salary, advances, payroll runs.
- Staff app self-scope and manager/owner permission boundaries.

## Phase 6 - Inventory And Purchase

- Products, suppliers, purchase bills, GRN, stock ledger, backbar, expiry, audits.

## Phase 7 - Finance And Reports

- Profit intelligence, invoice reports, balance sheet, ledger reconciliation.
- Report filters use real persisted ranges and API-backed results only.

## Phase 8 - Platform And AI

- SaaS admin, subscriptions, AI assistant, WhatsApp/SMS/email workflows.

## Phase Rule

Each phase must finish with the smallest useful verification: targeted Cargo
check/test for backend changes, TypeScript check for Angular template/type
changes, or focused API/browser smoke for runtime wiring.
