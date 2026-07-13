# POS Data Contract Map

## Decision

`pos_sales` is the canonical Rust invoice table. Do not create a second `invoices` table in PostgreSQL.

Every imported monetary value converts once from legacy SQLite rupees/`REAL` to PostgreSQL paise/`BIGINT`. Every migrated durable record has `tenant_id` and `branch_id`; no blank branch is silently accepted.

## Phase 2 DB contract status

Completed in migration `backend-rust/migrations/0019_pos_db_contract_completion.sql`.

| Domain | PostgreSQL contract |
| --- | --- |
| Invoice | Reuse `pos_sales`, `pos_sale_lines`, `pos_invoice_events`; add `pos_invoice_number_sequences` and `pos_invoice_snapshots`. |
| Payment | Reuse `pos_payments` and `pos_payment_method_settings`; add `pos_payment_links`, `pos_payment_events`, and `pos_payment_reconciliation_runs`. |
| Wallet/store credit | Reuse `wallet_transactions`, `store_credits`, and `store_credit_transactions` from migration `0016`. |
| Gift card | Add `gift_cards` and `gift_card_transactions`. |
| Membership/package | Reuse `memberships`, `packages`, `client_memberships`, `client_package_credits`, `pos_package_redemptions`; add `client_membership_credits` and `pos_membership_redemptions`. |
| Cash drawer | Add `cash_drawer_sessions` and `cash_drawer_movements`. |

No duplicate invoice/payment truth table is introduced. Later Rust repository work must use these tables instead of JSON-only or UI-only state.

## Canonical table mapping

| Legacy SQLite table(s) | Legacy key columns | Rust PostgreSQL table | Reuse or migration | Notes |
| --- | --- | --- | --- | --- |
| `invoices`, `sales` | `id`, `saleId`, `clientId`, `invoiceNumber`, `lineItems`, `subtotal`, `discount`, `gstAmount`, `total`, `paid`, `balance`, `status`, `dueDate`, timestamps | `pos_sales` | Reuse existing | Map invoice identity to `pos_sales.id`; map number to `invoice_number`; totals to `*_paise`; use `business_date`, `status`, `finalized_at`, `reference_id`. Legacy JSON `lineItems` is not retained as a source of truth after line import. |
| `invoice_items`, invoice JSON line items | invoice/item IDs, quantity, price, discount, tax | `pos_sale_lines` | Reuse existing | One PostgreSQL row per line. Preserve `line_type`, `item_id`, `item_name`, `staff_id`, quantity, unit price, gross/taxable/GST, amount or percentage discount. |
| `payments`, `invoice_payments` | invoice ID, mode, amount, reference, provider IDs, status, paid time | `pos_payments` | Reuse base; extend | `method`, `amount_paise`, `method_reference`, `label`, notes are existing. Provider lifecycle fields need separate payment-link/event tables below, not duplicate payment rows. |
| `invoice_events`, `invoice_snapshots`, `invoice_audit_log` | invoice ID, event type, actor, source, payload, hash chain | `pos_invoice_events` | Reuse existing; extend if necessary | Preserve append-only lifecycle event semantics and hashes. Snapshot payload needs a JSONB snapshot column or dedicated `pos_invoice_snapshots` table. |
| `invoice_number_sequences` | branch, next sequence | invoice-number sequence table | New migration | Do not generate numbers from random IDs once legacy numbering is imported. Scope unique sequence by tenant, branch and invoice type. |
| `wallet_transactions` | client, type, amount, balance after, reference, notes, metadata | `wallet_transactions` plus `clients.wallet_balance_paise` | New ledger migration | Existing client balance is a cache/KPI. Ledger rows are the durable wallet truth; calculate/debit/credit atomically. |
| `store_credits`, `store_credit_transactions` | customer, source invoice/refund, amount/balance, expiry, reason, transaction type | store-credit tables | New migration | Keep credit balance and immutable transaction rows; redemption references a POS sale. |
| `gift_cards`, `gift_card_transactions` | code, client, initial value, balance, expiry, status, redemption history | gift-card tables | New migration | Unique code per tenant; balance in paise; immutable sell/redeem/adjustment transactions. |
| `memberships` | client, plan, price, credits, service credits, validity, status | `memberships`, `client_memberships` | Reuse existing; extend | Rust already separates catalog from client assignment. Add credit balances/redemption ledger before importing service credits. |
| `packages`, `package_redemptions` | catalog price, service IDs, package credits, rules, status | `packages` plus client package/redemption tables | Reuse catalog; new client-credit migration | Do not store package credit only inside JSON. Each redemption must reference sale, client, package and line. |
| `credit_notes`, `invoice_voids`, `finance_refunds` | invoice, client, amount, reason, status, line items, actor | credit-note/refund/void tables | New migration | Preserve original invoice; never overwrite paid/total values to represent refund or void. |
| `invoice_documents`, `print_jobs` | invoice, format, content/payload, print device/job status | invoice artifact/print job tables | New migration | `pos_invoice_action_history` remains user-action history only; generated artifact and device queue need durable records. |
| `invoice_notification_queue`, `invoice_notification_delivery_logs` | invoice, recipient/channel, status, attempts, provider response | invoice notification queue/delivery tables | New migration | Keep queued/sent/failed truth separate from UI action history. |
| `business_notification_profiles`, `businessNotificationContactVerifications` | tenant/branch contact, OTP/status, attempts, expiry | notification profile/contact-verification tables | New migration | Preserve unique tenant/branch/contact index and verification lifecycle. |
| `invoice_payment_links`, `invoice_payment_events`, `payment_webhook_events`, `payment_reconciliation_runs` | provider IDs, links, event IDs, idempotency key, signature result, reconciliation result | POS payment-link/event/reconciliation tables | New migration | Payment provider contracts must be additive and separate from `pos_payments`. |
| `due_recovery_followups` | invoice/client/manager, status, note, action type, actor, time | due-recovery follow-up table | New migration | Invoice report must read saved follow-ups, not derive fake follow-up state only from ageing. |
| `corporate_accounts`, `corporate_account_members`, `credit_invoices`, `credit_payments` | company, credit limit, member, outstanding, settlement | corporate billing tables | New migration | Separate corporate credit workflow from client wallet/store credit. |
| payment method `settings` | branch setting JSON | `pos_payment_method_settings` | Reuse existing | Existing Rust table provides name, code, settlement type, shortcut, active, invoice visibility, reference flag and sort order. |

## Required column conversion

| Legacy column pattern | Rust column pattern | Conversion rule |
| --- | --- | --- |
| `tenantId`, `tenant_id` | `tenant_id` | Preserve opaque text ID exactly. Reject rows without a resolvable tenant. |
| `branchId`, `branch_id`, blank branch | `branch_id` | Resolve from source sale/client/terminal before import. Quarantine unresolved blank branch rows. |
| `clientId`, `customerId` | `client_id` | Preserve client ID after client map validation. |
| `invoiceNumber`, `creditNoteNumber` | `invoice_number`, `credit_note_number` | Preserve as text; apply tenant/branch uniqueness audit before import. |
| SQLite `REAL` money | `*_paise BIGINT` | Parse decimal string exactly, multiply by 100 once, round only by approved business rule. Never import through binary floating-point arithmetic. |
| `createdAt`, `updatedAt`, `paid_at`, `dueDate`, expiry strings | `TIMESTAMPTZ` or `DATE` | Parse in IST business context; invalid values go to import quarantine. |
| JSON text (`lineItems`, `rules`, `metadata`, payload) | normalized rows or `JSONB` | Normalize transactional line/credit/payment data. Retain only supporting metadata as JSONB. |
| `status` text | constrained status text | Preserve raw value during staging, then map only through approved status matrix. Unknown values block cutover. |

## Index and idempotency lock

| Legacy SQLite index/constraint | PostgreSQL requirement |
| --- | --- |
| `invoice_payments(tenant_id, invoice_id, status)` | index POS payment rows by `(tenant_id, branch_id, sale_id, status, created_at DESC)` when provider lifecycle is added |
| `invoice_payments(tenant_id, provider, provider_payment_id)` | unique or indexed provider payment identity scoped by tenant/provider |
| `invoice_payment_links(tenant_id, invoice_id, status)` | index payment links by tenant, branch, sale, status |
| `invoice_payment_links(tenant_id, status, expires_at)` | index outstanding/expired links for scheduler/recovery jobs |
| `invoice_payment_events(tenant_id, invoice_id, created_at)` | append-only invoice payment event index |
| partial unique `invoice_payment_events(tenant_id, idempotency_key)` | PostgreSQL partial unique index where key is non-empty |
| unique `payment_webhook_events(tenant_id, provider, event_id)` | PostgreSQL unique constraint; webhook retries must be no-op |
| `payment_webhook_events` provider/status/invoice indexes | indexes for reconciliation and retry workers |
| `invoices(tenant_id, branch_id, balance_due)` | existing/new `pos_sales` due index on tenant, branch, status, balance and business date |
| `wallet_transactions(tenantId, clientId, createdAt)` | wallet ledger index `(tenant_id, branch_id, client_id, created_at DESC)` |
| `due_recovery_followups` invoice and manager/status indexes | equivalent PostgreSQL indexes required before report migration |
| payment modes unique code by tenant/branch | already present in `pos_payment_method_settings` |

## Status transition lock

The import starts with a distinct staging value. Production statuses are not inferred from amount alone.

| Workflow | Required evidence before Rust mapping |
| --- | --- |
| Invoice | source status value, allowed next statuses, whether stock/coupon/redemption already occurred |
| Draft/held/resumed | cart lines, client, discount/coupon, payment draft, references and timestamps |
| Payment | pending/paid/failed/reconciled/refunded provider state plus idempotency key/event ID |
| Refund/void/credit note | reason, actor, original invoice, amount/lines, ledger and wallet/store-credit effect |
| Gift card/store credit/wallet | active/expired/blocked state, remaining balance, transaction reason and reference |
| Notification | queued/sent/failed status, recipient, provider message ID, retry count and failure reason |
| Due recovery | open/pending/completed follow-up status, manager, note, reminder/call action and time |

## Migration order

1. Create PostgreSQL staging tables with legacy IDs and raw status/JSON fields.
2. Import clients, branches and staff mapping first.
3. Import `pos_sales`, lines and canonical payment rows in one transaction per invoice.
4. Import invoice events, documents and action history.
5. Import wallet/store credit/gift-card ledgers, memberships/packages and redemptions.
6. Import provider payment links/events/reconciliation and notification history.
7. Import due-recovery follow-ups and corporate credit records.
8. Validate totals, balances, counts, status distribution, unique invoice numbers and idempotency constraints before cutover.

## Domain implementation order

Implement and verify each domain in this order. A later domain must reuse the persisted contract from earlier domains; it must not create local-only balance, tax, payment, or invoice state.

1. Client, wallet and credits
2. Service/product, tax, discount and coupon
3. Invoice draft, hold, resume and finalize
4. Payment split, active payment modes and references
5. Print/PDF and WhatsApp/email request history
6. Due/unpaid, recovery, ageing and follow-up
7. Sales register and invoice reports
8. Membership, package and gift-card redemption

Each step closes only when its tenant/branch scope, paise calculations, status transitions, idempotency requirements, and API-to-DB flow are covered by the contract above.

## Data-contract acceptance checklist

- [ ] Every legacy table above has a target PostgreSQL table, explicit non-import decision, or approved consolidated mapping.
- [ ] Every legacy money field has a named `*_paise` destination and conversion test vector.
- [ ] Existing `pos_sales`, `pos_sale_lines`, `pos_payments`, `pos_invoice_events`, `clients`, `client_memberships`, `memberships`, `packages` and `pos_payment_method_settings` are reused before any new table is created.
- [ ] No invoice/payment/wallet/gift/store-credit/redemption record lacks tenant and branch scope after import.
- [ ] Invoice number, provider event and idempotency uniqueness checks pass before any source system is retired.
- [ ] Every imported final invoice has matching line subtotal, discounts, GST, total, paid and due paise values.
- [ ] Wallet, gift-card and store-credit balances equal the sum of their immutable ledger transactions.
- [ ] Unknown status, malformed money/date, missing tenant/branch, or broken foreign key rows are quarantined with a reason; never silently defaulted.
