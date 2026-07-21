# POS Old Project To Rust Safe-Port Audit

Date: 15/07/2026

## Source Boundary

- Reference only: [Aurashine-Infitech/New-project](https://github.com/Aurashine-Infitech/New-project) at `main@1befb42ad197a575de818bbb2e0b01f460d9e554`
- Target: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\AuraShine CRM Rust`
- Legacy frontend billing module: 37 files / 2,467 lines under `src/app/features/billing/`
- Directly named legacy POS/billing backend set: 57 files / 10,672 lines across routes, services, controller, validation and provider adapters
- Full legacy file inventory: `docs/POS_LEGACY_FULL_INVENTORY.md`
- No legacy file is copied directly. SQLite/Express code is translated only when a capability is missing from the PostgreSQL/Axum implementation.

The verified Git `main` snapshot adds no unported operational POS capability beyond the coverage matrix below. Current Rust remains authoritative for money, inventory, accounting, invoice lifecycle and provider webhook truth.

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
| Invoice delivery/outbox/reminders | Delivery service, persisted outbox, status/attempt history and due-reminder action | Complete after Phase 6C | Reuse |
| Payment links and reconciliation | Persistent payment-link list/create/copy/open/reconcile flow | Complete after Phase 3 | Reuse |
| Membership sale/redemption | POS membership and client KPI flows | Complete | Reuse |
| Package sale/redemption | POS package credit flow | Complete | Reuse |
| Product inventory consumption/refund restock | Transactional stock ledger logic | Complete | Reuse |
| Gift card sale | POS gift-card route and checkout line | Complete | Reuse |
| Offline checkout replay safety | `/pos/offline-checkout` with operation identity | Complete after Phase 4 | Reuse |
| Payment method settings | POS payment-mode settings page and repository | Complete | Reuse |
| POS/invoice settings | Branch profile, A4/thermal, appearance, compliance, GST, UPI and bilingual labels | Complete after Phase 6D audit | Reuse; no proven legacy gap remains |
| Basic cash drawer open/movement/close/approval | `routes/cash_drawer.rs` and `/pos/cash-drawer` | Complete after Phase 5 | Reuse |
| Advanced EOD: tills, denominations, handover, deposits, approval and three-way settlement | Multi-till POS attribution, server count, independent RBAC approval, bank deposit tracking and expiring public review token | Complete after Phase 7 | Reuse |
| Provider reconciliation runs/import/review | Manual or atomic CSV provider statements matched against paid links and bank net | Complete after Phase 6B | Review only real mismatches |
| Dedicated daily closing report | Cash, payment-mode, deposit and reconciliation exception report | Complete after Phase 6B | Reuse |
| Legacy billing analytics/fraud guards | Payment overrun, idempotency, signed webhook, refund/credit, discount/margin and independent approval guards | Complete after Phase 6D audit | Reuse existing stronger controls |
| Terminal registry, sessions, heartbeat and terminal sales | Branch terminals, active operator sessions, device heartbeat and terminal-scoped sales | Complete after Phase 7 | Added |
| Print-device registry, queue and retry | Thermal/A4 devices plus claim/result/retry job lifecycle | Complete after Phase 7 | Added |
| Immutable Z report and day lock/reopen | Versioned SHA-256 Z snapshot plus database mutation guard | Complete after Phase 7 | Added |
| EOD accounting, tax register and Tally export | Locked-day accounting batch plus JSON/CSV/Tally exports | Complete after Phase 7 | Added |
| Owner risk inbox and approval-token review | Risk scan/resolution plus expiring, hashed, one-use approval links | Complete after Phase 7 | Added |
| Cashfree and PhonePe payment adapters | Provider create/status/reconciliation and signed webhook verification | Complete after Phase 7 | Credentials required for activation |
| Float suggestion and settlement exceptions | Real closed-drawer history and provider mismatch risk cases | Complete after Phase 7 | Added |
| Invoice notification identity | Branch sender/media profile with provider-backed verification gate | Complete after Phase 7 | Added |
| Corporate billing workflows | Corporate account, credit limit, terms, invoice reference and guarded assignment | Complete after Phase 7 | Added |

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
5. Cash drawer open, movement, blind close, variance approval and EOD report UI — implemented.
6. Advanced cash-drawer/EOD — implemented through Phase 6D with multi-till, deposits, settlement matching, daily close, delivery UI and guard audit.
7. Extended enterprise parity — implemented with terminals, print queue, immutable Z/day lock, EOD posting/export, owner risk/approval, Cashfree/PhonePe adapters, notification identity and corporate billing.

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

## Phase 5 Evidence

- Added one authenticated `/pos/cash-drawer` workspace over the existing Rust cash-drawer and EOD report APIs.
- Opening cash, cash in/out/refund movements, blind counted cash, zero-variance close and manager variance approval use real PostgreSQL-backed data.
- Every successful action reloads the current drawer and report; no browser-only cash truth or sample rows were added.
- Existing Rust authorization, cash-payment gate, transaction locking and audit events remain authoritative.

## Phase 6A Evidence

- Blind close now accepts denomination counts and loose cash; Rust validates overflow, duplicates and negative values, then calculates the authoritative counted total.
- The saved denomination breakdown remains attached to the existing tenant/branch/date cash-drawer session.
- Shift handover accepts only a real active branch staff record, locks the current drawer and records an audit event before commit.
- The existing `/pos/cash-drawer` page reloads real drawer data after both actions; no parallel EOD page or browser-only cash truth was added.

## Phase 6B Evidence

- Added branch-scoped bank deposits with counted-cash limits, unique bank references, independent manager confirmation and auditable status changes.
- Added real child tills under the existing drawer; cash sales persist their till ID, multiple open tills require explicit checkout selection, and every till must close before master day-close.
- Till variance and drawer variance retain authenticated independent approval. A separate owner review link now uses an expiring, SHA-256-hashed, one-use token and records the reviewer decision without exposing tenant identifiers.
- Provider reconciliation accepts one statement or an atomic CSV batch, calculates system gross from paid provider links, compares statement gross and fees to bank net, and sends every mismatch to manager review.
- Daily Closing now includes payment-mode totals, confirmed/pending deposits and unresolved provider reconciliation exceptions.

## Phase 6C Evidence

- Invoice detail now queues email or WhatsApp delivery through the existing outbox using an idempotency key.
- Real delivery status, recipient, attempts and provider error state reload from PostgreSQL.
- The existing due-reminder scheduler is available from invoice UI and reports its real queued count.

## Phase 6D Evidence

- Current branch invoice settings already cover the proven legacy A4/thermal, business profile, visibility, GST, UPI, terms and bilingual label fields; no duplicate settings schema was added.
- Existing POS guards already block payment overruns, unsafe gateway confirmation, duplicate lifecycle writes, invalid refunds/credits and unsafe discount or margin rules.
- Advanced EOD adds independent approvals, deposit amount limits, forced till attribution and provider mismatch review as additional financial-risk controls.

## Phase 7 Evidence

- Registered POS terminals own heartbeat, active operator session and terminal-scoped sales history; checkout accepts only a real active branch terminal.
- Thermal/A4 print devices use a persistent server queue with atomic claim, bounded attempts, result recording and explicit retry.
- Day close requires closed drawers, then locks the business date. Database triggers reject later sale, line and payment mutations until an authorized reopen with reason.
- Z reports are immutable versioned snapshots with a SHA-256 checksum. JSON, CSV and Tally-compatible export reuse the saved snapshot, and accounting posting is idempotent per Z version.
- Risk scan persists cash variance, unresolved settlement, open till, duplicate reference, overpayment, excessive discount, repeated void and refund-abuse cases. Every case now carries a real amount-at-risk value; managers resolve or dismiss it with an audit note.
- Razorpay, Cashfree and PhonePe share the current payment-link lifecycle. Provider status reconciliation and signed webhook verification remain authoritative; unavailable credentials produce an unavailable state, never a fake payment.
- Float suggestion is calculated only from real closed-drawer history. Existing provider-reconciliation mismatches feed the financial risk inbox.
- Invoice notification identity stores sender, owner and reporting contacts, channel preferences, daily-report schedule and database-backed logo/signature media. Contact ownership uses a throttled, expiring, hashed six-digit OTP with a five-attempt lock; provider readiness alone no longer marks a contact verified.
- Corporate billing adds account GSTIN/phone, real client members, per-member spending limits, due-dated corporate credit invoices, idempotent FIFO credit-payment allocation, account statements and consolidated current/overdue outstanding.
- `/pos/enterprise` connects all Phase 7 controls to real APIs; `/cash-drawer-approval/:token` is the limited public review surface.

## Final Legacy-Parity Completion Evidence

- Pending cash operations are corrected by an inverse movement that references the original record; financial movement deletion is not exposed. A database uniqueness guard prevents a second reversal, and every correction is written to the existing cash-drawer audit stream.
- Pending bank deposits can be amended only by owner/admin/manager. The service rechecks counted-cash availability, preserves the original audit trail and records amendment actor, reason and time.
- Accounting preview and HSN/SAC tax-register endpoints reuse current POS sales and line data without posting or mutating the day. Provider statement exceptions remain on the current Cash Drawer reconciliation surface instead of creating a duplicate page.
- The enterprise UI now exposes corporate members, credit conversion, FIFO payments and statement balances; verified notification contacts/media/schedule and global outbox retry; amount-at-risk fraud KPIs; and EOD accounting/tax previews.
- Strict source-code parity for the four previously partial groups is complete. Live Cashfree, PhonePe, Razorpay, WhatsApp and email operation still requires real credentials, reachable webhooks and production reconciliation evidence.

## Reliability and Financial Integrity Evidence

- Checkout continues to commit invoice, payment, inventory and accounting writes in one PostgreSQL transaction; duplicate checkout/payment protection remains idempotency-key and row-lock based.
- Invoice delivery and print queues stop automatic processing after five failed attempts. Terminal failed jobs remain visible as dead-letter work and explicit retry resets a fresh bounded attempt budget.
- A five-minute worker matches invoice paid totals to payment rows, verifies balanced journals and detects invoices missing their accounting journal; findings use the existing real-data risk inbox.
- `GET /api/v1/pos/reliability` exposes database query latency/pool state, queue depth/lag/dead-letter counts and current financial matching exceptions. Checkout latency is emitted as structured `pos.checkout` tracing data.
- A focused PostgreSQL concurrency test verifies that two checkout writers serialize through `FOR UPDATE`, preventing a lost payment update.

## Deferred By Design

- No Express/SQLite source was copied.
- No duplicate frontend state store was added.
- No duplicate route-level frontend page was added for behavior already supported by the existing Enterprise, Cash Drawer and Invoice surfaces.
- Provider credential activation and external delivery still depend on real environment configuration; no fake provider or bank response is generated.
