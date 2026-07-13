# POS Old Project To Rust Safe-Port Audit

Date: 13/07/2026

## Source Boundary

- Reference only: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\New project`
- Target: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\AuraShine CRM Rust`
- Legacy frontend billing module: 70 files / 2,442 lines under `src/app/features/billing/`
- Directly named legacy POS/billing backend set: 54 files / 11,053 lines across routes, services, controller, validation and migrations
- Full legacy file inventory: `docs/POS_LEGACY_FULL_INVENTORY.md`
- No legacy file is copied directly. SQLite/Express code is translated only when a capability is missing from the PostgreSQL/Axum implementation.

## Safe-Port Rules

1. Reuse current `/api/v1/pos` and `/api/v1/billing` compatibility routes.
2. Keep money as integer paise and every query tenant/branch scoped.
3. Reuse current PostgreSQL transactions, idempotency keys, invoice events, accounting, inventory, membership, package and wallet flows.
4. Add only missing behavior; do not recreate legacy Angular stores or Express services beside current logic.
5. Port destructive actions with a reason, explicit consequence, backend authorization and targeted reload.
6. Verify each phase independently before starting the next one.

## Capability Coverage

| Legacy capability | Current Rust/Angular equivalent | Status | Safe action |
| --- | --- | --- | --- |
| POS checkout and cart | `pages/pos/pos-page.*`, `routes/pos.rs` | Complete | Reuse |
| Service/product picker and barcode search | POS catalog search ranks name, code, SKU and barcode | Complete | Reuse |
| Customer selection/profile summary | POS client search and KPI endpoint | Complete | Reuse |
| Staff assignment and percentage split | POS line staff splits with 100% validation | Complete | Reuse |
| Invoice draft, line edit and finalize | `/pos/invoices/*` and `/billing/invoices/*` | Complete | Reuse |
| Hold and resume invoice | Held invoice page plus resume endpoint | Complete | Reuse |
| Cash/card/UPI/multi-mode payment | Configured payment methods and payment split payload | Complete | Reuse |
| Partial/due payment collection | POS sales page and payment endpoint | Complete | Reuse |
| Refund/partial item return | Invoice return drawer and transactional refund endpoint | Complete | Reuse |
| Invoice void | Transactional Rust endpoint | Complete after Phase 1 | Added missing frontend action |
| Credit note | Rust endpoint, refund credit-note generation and invoice-detail action | Complete after Phase 2 | Reuse |
| Invoice PDF/print | `services/invoice_pdf.rs` and print helpers | Complete | Reuse |
| Invoice appearance and bilingual settings | Branch-scoped invoice settings | Complete | Reuse |
| Invoice action history and ledger verification | History plus on-demand ledger verification in invoice detail | Complete after Phase 2 | Reuse |
| Invoice delivery/outbox/reminders | Delivery service, outbox and reminder endpoints | Backend complete, UI partial | Connect real delivery state later |
| Payment links and reconciliation | Persistent payment-link list/create/copy/open/reconcile flow | Complete after Phase 3 | Reuse |
| Membership sale/redemption | POS membership and client KPI flows | Complete | Reuse |
| Package sale/redemption | POS package credit flow | Complete | Reuse |
| Product inventory consumption/refund restock | Transactional stock ledger logic | Complete | Reuse |
| Gift card sale | POS gift-card route and checkout line | Complete | Reuse |
| Offline checkout replay safety | `/pos/offline-checkout` with operation identity | Complete after Phase 4 | Reuse |
| Payment method settings | POS payment-mode settings page and repository | Complete | Reuse |
| POS/invoice settings | Invoice profile, appearance and compliance settings | Core complete | Map only proven legacy-only fields |
| Basic cash drawer open/movement/close/approval | `routes/cash_drawer.rs` and repository | Backend complete | Connect existing finance UI before adding routes |
| Advanced EOD: tills, denominations, handover, deposits, approval tokens, risk and three-way settlement | No one-to-one current workflow | Missing | Separate finance project; requires schema and UI approval |
| Provider reconciliation runs/import/review | Payment-link reconcile is narrower | Partial | Phase 5 after provider requirements |
| Dedicated daily closing report | Current cash drawer covers base close | Partial | Add only after EOD scope approval |
| Legacy billing analytics/fraud guards | Current reports, discount rules and lifecycle validation overlap | Partial/overlapping | Audit per rule; do not bulk-port |

## Legacy Files Not To Copy

- `pos-cart.store.ts`, `payment.store.ts`, `billing.store.ts`: current POS component and API flows already own this state.
- `billing.service.js`, `payment.service.js`, `invoice-calculation.service.js`: current Rust transaction flow already owns totals, payments and lifecycle rules.
- `billing-inventory.service.js`, `billing-membership.service.js`, `billing-package.service.js`: current Rust checkout already performs these writes transactionally.
- SQLite schema helpers: incompatible with PostgreSQL/SQLx and must never enter the target repo.
- `server/app.js` registration: target registration stays in `backend-rust/src/routes/mod.rs`.

## Safe Delivery Phases

1. Void invoice frontend connection — implemented.
2. Credit-note and invoice-ledger verification actions in the existing invoice detail panel — implemented.
3. Payment-link creation, status and reconciliation UI using existing Rust endpoints — implemented.
4. Offline checkout UI wrapper using the existing idempotent Rust endpoint — implemented.
5. Provider reconciliation workflow after Razorpay/provider requirements are confirmed.
6. Advanced cash-drawer/EOD as a separately approved finance scope with additive migrations.

## Phase 1 Evidence

- Added `Void invoice` only for unpaid `draft` or `open` invoices.
- Requires a manager approval reason.
- Sends an idempotency key to the existing Rust endpoint.
- Rust validates state, records actor/reason, locks the invoice and writes `invoice.voided` inside one PostgreSQL transaction.
- The invoice list reloads automatically after success.

## Phase 2 Evidence

- Added credit-note creation only for eligible non-draft, non-voided and non-cancelled invoices.
- Requires a positive amount and reason; optional notes and an idempotency key are sent to the existing Rust endpoint.
- Rust remains authoritative for remaining credit limits, invoice status, numbering, accounting posting and event recording.
- Added read-only ledger verification using the existing hash-chain endpoint.
- The UI reports verified event count or the failed event position without exposing ledger payload data.
- The invoice list and details reload automatically after credit-note creation.

## Phase 3 Evidence

- Added a tenant/branch-scoped GET on the existing invoice payment-links route so links survive page reloads.
- Payment-link creation defaults to the real invoice balance and rejects zero, negative or over-balance amounts before submission.
- Existing Rust provider configuration, finalized-invoice validation and idempotency remain authoritative.
- Invoice detail shows persisted link amount, provider, status and real provider URL when available.
- Copy and Open use the provider URL returned by the backend; no placeholder URL is generated.
- Reconciliation calls the existing Razorpay status endpoint and displays provider status, paid amount and signed-webhook requirement.

## Phase 4 Evidence

- The existing POS page detects browser online/offline state without adding a new route or state library.
- A disconnected finalized checkout is stored in a tenant/branch-scoped device queue with a replay-safe operation ID.
- Reconnect and manual retry use the existing `/api/v1/pos/offline-checkout` endpoint; completed operations are removed and 4xx conflicts remain visible for review.
- Offline held-invoice edits are blocked so a held invoice cannot be duplicated as a new sale.
- Appointment completion runs only after the queued invoice has synced successfully.

## Deferred By Design

- No Express/SQLite source was copied.
- No duplicate frontend state store was added.
- No new route or database migration was added for behavior already supported by Rust.
- Advanced EOD and reconciliation were not bundled into the invoice change because they have separate data, permissions and accounting risk.
