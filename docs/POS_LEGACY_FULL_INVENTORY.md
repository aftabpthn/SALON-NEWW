# Legacy POS Full Inventory

Source: [Aurashine-Infitech/New-project](https://github.com/Aurashine-Infitech/New-project)

Verified ref: `main@1befb42ad197a575de818bbb2e0b01f460d9e554`

Scan date: 15/07/2026

## Verified Size

| Area | Files | Lines |
| --- | ---: | ---: |
| Angular billing feature | 37 | 2,467 |
| Directly named backend billing/POS files | 57 | 10,672 |
| Angular billing store specs | 4 | 147 |
| Additional POS/billing integration tests | 28 | Not counted |

The backend count covers the Git snapshot's directly named billing, payment, invoice, refund, cash-drawer, POS, credit, corporate, reconciliation, terminal and print files, including payment-provider adapters. Cross-module dependencies are listed separately.

## Angular Routes And Pages

`src/app/features/billing/billing.routes.ts` exposes:

- POS checkout page.
- Invoice list page.
- Invoice detail page.
- Refunds page.
- Daily closing page.
- Reconciliation page.
- Core money-flow page.

## Angular Application And Data Layer

| File | Responsibility |
| --- | --- |
| `application/billing.store.ts` | Selected customer/branch, autosave state and billing permissions. |
| `application/offline-sync.store.ts` | Browser online state, queued operations, sync state and conflicts. |
| `application/payment.store.ts` | Split-payment lines and payment busy state. |
| `application/pos-cart.store.ts` | Cart lines, barcode state and local subtotal/tax/total calculations. |
| `application/print.store.ts` | Print devices/jobs, terminal selection and barcode resolution. |
| `data/billing.api.ts` | Invoice read and refund calls. |
| `data/billing.repository.ts` | Invoice list/draft persistence and cart preview orchestration. |
| `data/offline-sync.api.ts` | Offline push and conflict API calls. |
| `data/payments.api.ts` | Payment, split payment and status calls. |
| `domain/invoice.model.ts` | Invoice, draft, line and payment record contracts. |
| `domain/invoice-item.model.ts` | Invoice item type export. |
| `domain/payment.model.ts` | Split-payment and payment-status contracts. |
| `domain/refund.model.ts` | Refund request/result contracts. |
| `domain/tax.model.ts` | Tax breakdown contract. |

## Angular Page Files

- `pages/pos-page/pos-page.component.ts`
- `pages/invoice-list-page/invoice-list-page.component.ts`
- `pages/invoice-detail-page/invoice-detail-page.component.ts`
- `pages/refunds-page/refunds-page.component.ts`
- `pages/daily-closing-page/daily-closing-page.component.ts`
- `pages/reconciliation-page/reconciliation-page.component.ts`
- `pages/core-money-flow-page/core-money-flow-page.component.ts`

The verified Git snapshot uses single-file standalone Angular components for these legacy pages.

## Angular Reusable POS Components

| Component | Files | Responsibility |
| --- | ---: | --- |
| Barcode input | 1 | Barcode entry and scan action. |
| Customer panel | 1 | Selected customer summary. |
| Daily closing panel | 1 | Compact close-day action. |
| Invoice cart | 1 | Cart lines, quantity, discount and totals. |
| Invoice preview | 1 | Invoice preview output. |
| Payment modal | 1 | Payment capture shell. |
| Print settings | 1 | Printer/format controls. |
| Refund modal | 1 | Refund reason/amount action. |
| Service/product picker | 1 | Catalog item selection. |
| Split payment | 1 | Multiple payment lines. |
| Tax breakdown | 1 | Tax component rows. |
| Void invoice modal | 1 | Manager reason and void action. |

## Angular Tests

- `application/billing.store.spec.ts`
- `application/offline-sync.store.spec.ts`
- `application/payment.store.spec.ts`
- `application/pos-cart.store.spec.ts`

The repository also contains billing/POS integration tests for paise safety, tenant isolation, races, webhook security, payment truth, settlement visibility, invoice notifications, staff picker, reports and route wiring.

## Core Backend Entry And Validation

| File | Responsibility |
| --- | --- |
| `server/app.js` | Registers public and authenticated `/api` and `/api/v1` routers. |
| `server/controllers/billing.controller.js` | HTTP-to-service billing controller. |
| `server/validators/billing.validator.js` | Billing request validation. |
| `server/utils/billing-happy-hours.middleware.js` | Happy-hours billing wrapper. |

## Direct Backend Route Files

- `server/routes/billing.routes.js`
- `server/routes/billing-analytics.routes.js`
- `server/routes/billing-health.routes.js`
- `server/routes/booking-payments.routes.js`
- `server/routes/cash-drawer-eod.routes.js`
- `server/routes/corporate-billing.routes.js`
- `server/routes/invoice-ledger.routes.js`
- `server/routes/invoice-notification.routes.js`
- `server/routes/payment-fraud-intelligence.routes.js`
- `server/routes/payment-method-settings.routes.js`
- `server/routes/payment.routes.js`
- `server/routes/pos-settings.routes.js`
- `server/routes/print-device.routes.js`
- `server/routes/reconciliation.routes.js`
- `server/routes/terminal.routes.js`

## Core Invoice Route Contract

`billing.routes.js` provides:

- List, create draft and read invoice.
- Update invoice and add/update/delete line.
- Apply invoice discount.
- Add payment and finalize.
- Void, refund and credit note.
- PDF and print.
- WhatsApp and email send.
- Customer invoice history.
- Appointment draft lookup.

## Payment Route Contract

`payment.routes.js` provides:

- Cash, UPI and card invoice payments.
- Split payment.
- Payment-link creation and status.
- Payment timeline.
- Provider reconciliation.
- Payment reminders.
- Reconciliation run list.
- Razorpay webhook aliases.

## Direct Backend Services

### Billing core

- `server/services/billing.service.js` — invoice lifecycle and persistence orchestration.
- `server/services/invoice-calculation.service.js` — price, discount, tax and payable calculation.
- `server/services/invoice-number.service.js` — invoice sequences.
- `server/services/invoice-void.service.js` — void validation and recording.
- `server/services/refund.service.js` — refund workflow.
- `server/services/credit-note.service.js` — credit-note generation.
- `server/services/credit-billing.service.js` — credit invoice/payment behavior.
- `server/services/corporate-account.service.js` — corporate account and member controls.
- `server/services/billing-compatibility-schema.service.js` — legacy schema compatibility.

### Payments and providers

- `server/services/payment.service.js`
- `server/services/razorpay-payment.service.js`
- `server/services/payment-method-settings.service.js`
- `server/services/payment-fraud-intelligence.service.js`
- `server/services/payment-providers/payment-provider.interface.js`
- `server/services/payment-providers/payment-provider.registry.js`
- `server/services/payment-providers/razorpay.provider.js`
- `server/services/payment-providers/cashfree.provider.js`
- `server/services/payment-providers/phonepe.provider.js`

### Invoice settlement, delivery and evidence

- `server/services/invoice-payment-collection.service.js`
- `server/services/invoice-payment-collection-schema.service.js`
- `server/services/invoice-event-ledger.service.js`
- `server/services/invoice-notification.service.js`
- `server/services/invoice-notification-schema.service.js`
- `server/services/invoice-whatsapp.service.js`
- `server/services/invoice-pdf.service.js`
- `server/services/invoice-print.service.js`

### POS-connected business flows

- `server/services/billing-inventory.service.js`
- `server/services/billing-membership.service.js`
- `server/services/billing-package.service.js`
- `server/services/billing-analytics.service.js`
- `server/services/billing-fraud-detection.service.js`
- `server/services/pos-profit-guard.service.js`
- `server/services/pos-settings.service.js`
- `server/services/print-device.service.js`
- `server/services/terminal.service.js`
- `server/services/offline-pos-sync.service.js`

### Cash drawer and EOD

- `server/services/cash-drawer.service.js`
- `server/services/cash-drawer-eod.service.js`
- `server/services/cash-drawer-eod-schema.service.js`

`cash-drawer-eod.service.js` is the largest legacy POS-adjacent service at roughly 3,098 lines. It covers sessions, tills, cash operations, handover, denominations, settlements, imports, deposit slips, accounting posting, tax register, Tally export, risk, approvals and close-day reports. It must remain a separately staged finance port.

## Cross-Module POS Dependencies

These files do not all contain POS/billing in their filename but are registered beside the billing workflow:

- `server/routes/offline-sync.routes.js`
- `server/routes/daily-closing.routes.js`
- `server/routes/reconciliation.routes.js`
- Gift-card route/service.
- Terminal and print-device route/service.
- Z-report route/service.
- Booking-deposit route/service.
- Appointment-deposit gate route/service.
- General, bill, tax and business-details settings routes.

## Legacy Database Migrations

- `server/db/migrations/20260521_enterprise_billing.sql`
- `server/db/migrations/20260521_corporate_credit_billing.sql`
- `server/db/migrations/20260521_invoice_event_ledger.sql`
- `server/db/migrations/20260521_offline_pos_sync.sql`
- `server/db/migrations/20260524_invoice_notifications.sql`
- `server/db/migrations/20260530_invoice_payment_collection.sql`
- `server/migrations/add-happy-hours-to-invoices.js`

## Main Legacy Data Areas

- Invoices, invoice items, taxes, discounts, payments, refunds, voids and snapshots.
- Invoice events, audit records, payment events, payment links and reconciliation runs.
- Membership and package redemption.
- Inventory transactions and service-recipe consumption.
- Offline queue and conflicts.
- Cash drawer sessions, tills, operations, denominations, settlements, deposits, handovers, risks, approvals, accounting, tax registers and reports.
- Notification queue/delivery logs and message logs.

## Important Safety Findings

1. Legacy frontend cart totals use local numeric calculations; target Rust totals must remain server-authoritative and paise-based.
2. Legacy backend is Express + SQLite and uses a different schema/naming model; files cannot be copied into Axum/PostgreSQL.
3. Multiple legacy modules overlap the same invoice/payment truth. Target must keep one transactional POS flow.
4. Provider adapters require real credentials and signed webhook verification; they cannot be marked live from source presence alone.
5. Advanced EOD touches accounting and approvals and requires additive PostgreSQL migrations plus permission mapping before UI work.

## Target Mapping

The authoritative target coverage and phased port status live in `docs/POS_OLD_PROJECT_TO_RUST_PORT_AUDIT.md`.
