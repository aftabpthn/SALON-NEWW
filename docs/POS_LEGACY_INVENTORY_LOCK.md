# POS Legacy Inventory Lock

## Scope and lock rule

Source reference: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\New project`.

No legacy POS, invoice, wallet, payment, print, notification, or due-recovery file is considered migrated until its API contract, durable tables, money calculation, validation, status transition, and frontend caller are checked below.

Money remains integer paise. Tenant and branch scope are mandatory on every durable record and query.

## Legacy frontend inventory

| Area | Legacy frontend files | User routes |
| --- | --- | --- |
| Counter POS | `src/app/pages/pos.component.ts`, `src/app/features/billing/pages/pos-page/pos-page.component.ts`, `src/app/features/billing/application/pos-cart.store.ts` | `/pos`, `/pos/holds`, `/pos/tips` |
| Invoice list/detail | `src/app/pages/pos-invoices.component.ts`, `src/app/features/billing/pages/invoice-list-page/invoice-list-page.component.ts`, `src/app/features/billing/pages/invoice-detail-page/invoice-detail-page.component.ts`, `src/app/features/billing/data/billing.api.ts` | `/pos/invoices`, `/billing/invoices`, `/billing/invoices/:id` |
| Invoice activity/reports | `src/app/pages/pos-invoice-activity.component.ts`, `src/app/pages/invoice-reports.component.ts` | `/pos/invoice-activity`, `/reports/invoices`, `/reports/invoices/:reportId` |
| Payment configuration/reporting | `src/app/pages/payment-modes.component.ts`, `src/app/pages/payment-mode-report.component.ts`, `src/app/features/billing/data/payments.api.ts`, `src/app/features/billing/application/payment.store.ts` | `/pos/payment-modes`, `/pos/payment-mode-report`, `/settings/payment-methods` |
| Print | `src/app/features/billing/application/print.store.ts` | invoice print/PDF actions |
| Wallet/offers | `src/app/pages/discount-rules/member-wallet-offers.component.ts` | `/discount-rules/member-wallet-offers` |

## Legacy backend API inventory

| Domain | Old API endpoints | Old route file | Required Rust destination | Status |
| --- | --- | --- | --- | --- |
| Invoice create/list/detail | `/billing/invoices`, `/billing/invoices/:id`, `/billing/invoices/draft`, `/billing/appointment/:appointmentId/draft`, `/billing/customer/:customerId/history` | `server/routes/billing.routes.js` | `backend-rust/src/routes/pos.rs` + POS repository/service | Partial |
| Draft line editing | `/billing/invoices/:id/add-item`, `/billing/invoices/:id/items/:itemId`, `/billing/invoices/:id/apply-discount` | `server/routes/billing.routes.js` | `backend-rust/src/routes/pos.rs` + invoice line service | Partial |
| Finalize/refund/void/credit note | `/billing/invoices/:id/finalize`, `/billing/invoices/:id/refund`, `/billing/invoices/:id/void`, `/billing/invoices/:id/credit-note` | `server/routes/billing.routes.js` | POS invoice lifecycle service | Partial |
| Invoice output | `/billing/invoices/:id/print`, `/billing/invoices/:id/pdf` | `server/routes/billing.routes.js` | POS print/PDF service | Partial |
| Email and WhatsApp | `/billing/invoices/:id/send-email`, `/billing/invoices/:id/send-whatsapp` | `server/routes/billing.routes.js` | notification/queue service behind POS route | Not started |
| Invoice ledger | `/invoice-ledger/:invoiceId/events`, `/invoice-ledger/:invoiceId/snapshot`, `/invoice-ledger/:invoiceId/verify` | `server/routes/invoice-ledger.routes.js` | invoice audit/ledger repository | Not started |
| Invoice notification queue | `/invoice-notifications/queue`, `/invoice-notifications/invoices/:invoiceId/queue`, `/invoice-notifications/:id/mark-sent`, `/invoice-notifications/:id/mark-failed`, profile and contact-verification routes | `server/routes/invoice-notification.routes.js` | notification delivery service | Not started |
| Payment collection | cash, UPI, card, split, payment-link, status, reconciliation, reminder, timeline, Razorpay webhook | `server/routes/payment.routes.js` | POS payments + payment provider adapter | Partial |
| Payment modes | `/settings/payment-methods`, `/pos/settings/payment-modes` | `server/routes/payment-method-settings.routes.js`, `server/routes/pos-settings.routes.js` | `payment_methods_repository.rs` + POS settings route | Implemented |
| Wallet/store credit/gift card | client store credit, gift-card status/sell/redeem, store-credit create/redeem | `server/routes/gift-card.routes.js` | wallet/gift-card repository and service | Not started |
| Membership/package redemption | billing membership/package calculations | `server/services/billing-membership.service.js`, `server/services/billing-package.service.js` | POS redemption service | Not started |
| Due recovery | due recovery list, manager assignment, follow-up note, call complete, reminder | `server/routes/due-recovery-report.routes.js` | due recovery repository/service + reports route | Not started |
| Member-wallet offer suggestions | evaluate, suggestions, status update | `server/routes/happy-hours-member-wallet.routes.js` | promotion/wallet recommendation module | Not started |

## Legacy service and durable-data inventory

| Legacy service/repository | Durable tables or records found | Locked responsibility |
| --- | --- | --- |
| `billing.service.js` | `invoices`, `invoice_items`, `invoice_payments`, `invoice_taxes`, `invoice_discounts`, `invoice_events`, `invoice_locks`, `invoice_audit_log`, `clients`, `sales` | draft/create/finalize lifecycle, item writes, discounts, tax, audit and locks |
| `invoice-calculation.service.js` | calculated invoice amounts | line totals, bill totals, discount/GST calculation parity |
| `invoice-event-ledger.service.js` | `invoice_events`, `invoice_snapshots`, `invoice_items`, `invoice_payments`, `invoice_taxes`, `invoices` | immutable lifecycle events, snapshots and verification |
| `invoice-number.service.js` | `invoice_number_sequences`, `branches` | tenant/branch invoice numbering |
| `invoice-payment-collection.service.js` | `invoice_payments`, `invoice_payment_events`, `invoice_payment_links`, `payment_reconciliation_runs`, `payment_webhook_events`, `booking_payment_links`, `payments`, `invoices`, `sales`, `clients`, `branches` | payment split, collection, reconciliation, link and webhook state |
| `payment.service.js` | `invoice_payments`, `invoices` | payment write/update rules |
| `payment-method-settings.service.js` | `settings` | branch payment mode configuration |
| `wallet.service.js` | `wallet_transactions` | client wallet debit/credit and balance truth |
| `credit-billing.service.js` | `corporate_accounts`, `credit_invoices`, `credit_payments`, `invoices` | corporate credit billing and settlement |
| `billing-membership.service.js` | `memberships`, `membership_redemptions` | membership sale/redemption validation |
| `billing-package.service.js` | `packages`, `package_redemptions` | package sale/redemption validation |
| `billing-inventory.service.js` | `inventory_transactions`, `invoice_items`, `invoices` | stock movement from finalized bill |
| `invoice-pdf.service.js`, `invoice-print.service.js` | generated invoice artifact | print/PDF output parity |
| `invoice-void.service.js` | `invoice_voids`, `invoices` | void rules and audit |
| `invoice-whatsapp.service.js` | outbound delivery contract | WhatsApp invoice send request |
| `invoice-notification.service.js` | `invoice_notification_queue`, `invoice_notification_delivery_logs`, `business_notification_profiles`, `businessNotificationContactVerifications`, `appointments`, `branches`, `clients`, `invoices`, `invoice_items`, `invoice_payments`, `payments`, `sales`, `tenants`, `tenant_users` | notification profile, recipient validation, queue and delivery history |
| `due-recovery-report.service.js` | `due_recovery_followups`, `invoice_payment_links` | outstanding ageing, owner assignment and follow-up workflow |
| `happy-hours-member-wallet.repo.js` | `wallet_transactions`, `memberships`, `clients`, `happyHoursMemberWalletSuggestions` | wallet/member offer evaluation and suggestion history |

## Backend 62-file inventory lock checklist

This is the locked legacy backend scope for POS migration. These 62 executable backend files must each map to a Rust route/service/repository/model/migration decision before legacy retirement. The AI prompt file `server/services/ai/prompts/posIntelligence.js` is related reference material, not counted as executable backend migration scope.

| # | Legacy backend file | Endpoint/API contract | Tables/records detected | Calculation keywords | Validation keywords | Status/lifecycle keywords | UI dependency | Lock status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `server/routes/billing.routes.js` | service/helper only | express | discount, refund, void | required, idempotency | draft, void, credit | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 2 | `server/routes/billing-analytics.routes.js` | service/helper only | express | split | none found | none found | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 3 | `server/routes/billing-health.routes.js` | service/helper only | express, node | gst, tax, refund | tenant | none found | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 4 | `server/routes/coupon-engine.routes.js` | service/helper only | express | coupon, redeem | required, validate, invalid, tenant, branch | none found | /pos settlement, discount rules | Locked |
| 5 | `server/routes/gift-card.routes.js` | service/helper only | express | redeem | required, validate | credit | /pos settlement, client KPI/history | Locked |
| 6 | `server/routes/invoice-ledger.routes.js` | service/helper only | express | none found | none found | none found | /pos/invoices, invoice activity | Locked |
| 7 | `server/routes/invoice-notification.routes.js` | service/helper only | express | none found | none found | failed, sent | /pos/invoices print/send actions | Locked |
| 8 | `server/routes/membership-enterprise.routes.js` | service/helper only | express | wallet, commission, redeem | required, validate | credit | /pos add-ons/redemption, /memberships, /packages | Locked |
| 9 | `server/routes/membership-settings.routes.js` | service/helper only | express | none found | none found | none found | /pos add-ons/redemption, /memberships, /packages | Locked |
| 10 | `server/routes/package-settings.routes.js` | service/helper only | express | none found | none found | none found | /pos add-ons/redemption, /memberships, /packages | Locked |
| 11 | `server/routes/payment.routes.js` | service/helper only | express | split | required, validate, idempotency, signature | none found | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 12 | `server/routes/payment-method-settings.routes.js` | service/helper only | express | none found | none found | none found | /pos/payment-modes, /settings/payment-methods, /pos | Locked |
| 13 | `server/routes/payment-fraud-intelligence.routes.js` | service/helper only | express | none found | none found | none found | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 14 | `server/routes/pos-settings.routes.js` | service/helper only | express | none found | none found | none found | /pos/payment-modes, /settings/payment-methods, /pos | Locked |
| 15 | `server/routes/cash-drawer-eod.routes.js` | service/helper only | express | tax | none found | pending | /pos/cash-drawer-eod | Locked |
| 16 | `server/routes/sales-tools.routes.js` | service/helper only | express | none found | none found | none found | /sales-tools, /pos reports | Locked |
| 17 | `server/controllers/billing.controller.js` | service/helper only | no direct table access | total, subtotal, discount, tax, paid, refund, void | tenant, branch | draft, finalized, paid, failed, void, credit, queued | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 18 | `server/services/billing.service.js` | service/helper only | clients, invoice_audit_log, invoice_discounts, invoice_events, invoice_items, invoice_locks, invoice_payments, invoice_taxes, invoices, node, ... | total, subtotal, discount, coupon, gst, tax, tip, round | required, validate, tenant, branch, active | draft, finalized, paid, partial, pending, void, credit, completed | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 19 | `server/services/billing-package.service.js` | service/helper only | package_redemptions, packages | redeem | required, tenant, active, expired | expired, active | /pos add-ons/redemption, /memberships, /packages | Locked |
| 20 | `server/services/billing-membership.service.js` | service/helper only | membership_redemptions, memberships | total, discount, redeem | required, tenant, active, expired | expired, active | /pos add-ons/redemption, /memberships, /packages | Locked |
| 21 | `server/services/billing-inventory.service.js` | service/helper only | inventory_transactions, invoice_items, invoices | total, tax, round | tenant, branch | none found | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 22 | `server/services/billing-fraud-detection.service.js` | service/helper only | AND, daily_closing, invoice_refunds, invoice_voids, invoices, sqlite_master | total, discount, round, refund, void | tenant, branch | void | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 23 | `server/services/billing-compatibility-schema.service.js` | service/helper only | invoices, node, sqlite_master | total, subtotal, discount, gst, tax, tip, round, paid | tenant, branch | finalized, paid, void, credit | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 24 | `server/services/billing-analytics.service.js` | service/helper only | invoice_item_margins, invoice_payments, invoices, sqlite_master | total, discount, tax, tip, round, paid, due, split | tenant, branch | draft, paid, void, cancelled | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 25 | `server/services/invoice-calculation.service.js` | service/helper only | no direct table access | total, subtotal, discount, gst, tax, tip, round, paid | required, branch | paid | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 26 | `server/services/invoice-number.service.js` | service/helper only | branches, invoice_number_sequences, node | none found | required, invalid, tenant, branch | none found | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 27 | `server/services/invoice-print.service.js` | service/helper only | no direct table access | total, discount, gst, tax, tip, balance, paid, due | branch | paid, pending, credit | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 28 | `server/services/invoice-pdf.service.js` | service/helper only | no direct table access | total, discount, gst, tax, tip, balance, paid, due | none found | paid, pending, credit | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 29 | `server/services/invoice-payment-collection.service.js` | service/helper only | booking_payment_links, branches, clients, invoice_payment_events, invoice_payment_links, invoice_payments, invoices, node, payment_reconciliation_runs, payment_webhook_events, ... | total, round, balance, paid, due, void | required, invalid, forbidden, tenant, branch, idempotency, signature, expired | paid, partial, pending, failed, void, queued, sent, completed | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 30 | `server/services/invoice-payment-collection-schema.service.js` | service/helper only | invoices, node | balance, paid, due | tenant, branch, signature | paid | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 31 | `server/services/invoice-notification.service.js` | service/helper only | SET, appointments, branches, businessNotificationContactVerifications, business_notification_profiles, clients, invoice_items, invoice_notification_delivery_logs, invoice_notification_queue, invoice_payments, ... | total, balance, paid, due, wallet, split | required, invalid, forbidden, tenant, branch, signature, active, expired | paid, pending, failed, queued, sent, completed, cancelled, expired | /pos/invoices print/send actions | Locked |
| 32 | `server/services/invoice-notification-schema.service.js` | service/helper only | businessNotificationContactVerifications, node | none found | tenant, branch | pending, sent | /pos/invoices print/send actions | Locked |
| 33 | `server/services/invoice-event-ledger.service.js` | service/helper only | invoice_events, invoice_items, invoice_payments, invoice_snapshots, invoice_taxes, invoices, node | tax | required, tenant | none found | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 34 | `server/services/invoice-whatsapp.service.js` | service/helper only | no direct table access | total, tax, paid, due, wallet, refund | tenant | paid, pending, queued | /pos/invoices print/send actions | Locked |
| 35 | `server/services/invoice-void.service.js` | service/helper only | invoice_voids, invoices | balance, commission, void | required, forbidden, tenant, branch | draft, failed, void | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 36 | `server/services/payment.service.js` | service/helper only | invoice_payments, invoices | total, round, balance, paid, due, split | required, tenant, branch | paid, partial, pending, failed | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 37 | `server/services/payment-method-settings.service.js` | service/helper only | SET, settings | total, round, due, wallet, split, refund | required, tenant, branch | partial | /pos/payment-modes, /settings/payment-methods, /pos | Locked |
| 38 | `server/services/payment-fraud-intelligence.service.js` | service/helper only | cash_variance_findings, discount_abuse_findings, payment_risk_findings | discount | tenant, branch | completed | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 39 | `server/services/payment-providers/payment-provider.interface.js` | service/helper only | no direct table access | paid | none found | paid | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 40 | `server/services/payment-providers/payment-provider.registry.js` | service/helper only | no direct table access | none found | none found | none found | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 41 | `server/services/payment-providers/razorpay.provider.js` | service/helper only | node | round, paid | invalid, tenant, signature, expired | paid, partial, pending, failed, expired | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 42 | `server/services/payment-providers/phonepe.provider.js` | service/helper only | node | round, paid | invalid, signature, expired | paid, pending, failed, completed, expired | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 43 | `server/services/payment-providers/cashfree.provider.js` | service/helper only | node | round, paid | invalid, signature, expired | paid, pending, failed, cancelled, expired | /pos, /pos/invoices, /pos/payment-mode-report | Locked |
| 44 | `server/services/wallet.service.js` | service/helper only | wallet_transactions | round, balance, wallet, refund | required, tenant | none found | /pos settlement, client KPI/history | Locked |
| 45 | `server/services/gift-card.service.js` | service/helper only | gift_card_transactions, gift_cards, node | round, balance, redeem | required, tenant, branch, active, expired | expired, active | /pos settlement, client KPI/history | Locked |
| 46 | `server/services/membership-enterprise.service.js` | service/helper only | POS, client_membership_ledger, clients, loyalty_transactions, membership, membership_audit_logs, membership_family_members, membership_invoice_snapshots, membership_plans, membership_self_service_requests, ... | total, discount, gst, tip, round, balance, paid, due | required, invalid, forbidden, tenant, branch, active, expired | paid, pending, failed, void, credit, queued, sent, cancelled | /pos add-ons/redemption, /memberships, /packages | Locked |
| 47 | `server/services/membership-settings.service.js` | service/helper only | SET, settings | discount, tax, round, balance, paid, due, wallet | required, tenant, branch, active, expired | paid, partial, credit, expired, active, inactive | /pos add-ons/redemption, /memberships, /packages | Locked |
| 48 | `server/services/package-settings.service.js` | service/helper only | SET, settings | discount, tax, round, paid, due, wallet | required, tenant, branch, active, expired | paid, partial, pending, credit, expired, active, inactive | /pos add-ons/redemption, /memberships, /packages | Locked |
| 49 | `server/services/pos-settings.service.js` | service/helper only | SET, settings | wallet | required, tenant, branch, active | credit, active | /pos/payment-modes, /settings/payment-methods, /pos | Locked |
| 50 | `server/services/pos-profit-guard.service.js` | service/helper only | service_recipe_items, service_recipes | total, discount, round, paid, commission, redeem | required, tenant, branch, active | paid, active | /pos settlement, discount rules | Locked |
| 51 | `server/services/tips.service.js` | service/helper only | branches, clients, invoice_tips, invoices, payments, sales, staff, tip_payout_ledger | total, tip, round, balance, paid, due, split, redeem | required, tenant, branch, active, duplicate | paid, pending, void, cancelled, active, inactive | /pos/tips, /pos settlement | Locked |
| 52 | `server/services/cash-drawer.service.js` | service/helper only | cash_drawer_sessions, invoice_payments, invoice_refunds, invoices | total, round, paid, refund | required, tenant, branch | paid | /pos/cash-drawer-eod | Locked |
| 53 | `server/services/cash-drawer-eod.service.js` | service/helper only | EOD, SET, WhatsApp, cashDrawerEodAccountingPostings, cashDrawerEodApprovalRequests, cashDrawerEodCashOperations, cashDrawerEodCollectionAdjustments, cashDrawerEodCollections, cashDrawerEodDenominations, cashDrawerEodDepo... | total, subtotal, gst, tax, round, balance, paid, wallet | required, tenant, branch, idempotency, signature, active, expired | draft, paid, pending, failed, credit, queued, cancelled, expired | /pos/cash-drawer-eod | Locked |
| 54 | `server/services/cash-drawer-eod-schema.service.js` | service/helper only | cashDrawerEodAccountingPostings, cashDrawerEodApprovalRequests, cashDrawerEodCashOperations, cashDrawerEodCollectionAdjustments, cashDrawerEodCollections, cashDrawerEodDenominations, cashDrawerEodDepositSlips, cashDrawer... | total, subtotal, gst, tax, balance | required, tenant, branch, signature | draft, pending, credit | /pos/cash-drawer-eod | Locked |
| 55 | `server/services/sales-tools-summary.service.js` | service/helper only | sqlite_master | total, discount, coupon, balance, paid, redeem, void | required, tenant, branch, active, expired | paid, pending, failed, void, queued, sent, cancelled, expired | /sales-tools, /pos reports | Locked |
| 56 | `server/services/credit-note.service.js` | service/helper only | no direct table access | total, tax, balance, refund | required, tenant, branch | draft, failed, credit | /pos related | Locked |
| 57 | `server/services/credit-billing.service.js` | service/helper only | corporate_accounts, credit_invoices, credit_payments, invoices | total, round, paid, due | required, tenant | paid, pending, credit | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 58 | `server/services/coupon-abuse.service.js` | service/helper only | coupon_abuse_alerts, coupon_usage | discount, coupon | tenant, branch | none found | /pos settlement, discount rules | Locked |
| 59 | `server/utils/billing-happy-hours.middleware.js` | service/helper only | no direct table access | total, discount, round | tenant, branch | none found | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 60 | `server/repositories/coupon-engine.repo.js` | service/helper only | discountCouponUsage, discountCoupons, sqlite_master | total, discount, coupon, round, split, redeem | required, validate, tenant, branch, active, expired | draft, expired, active | /pos settlement, discount rules | Locked |
| 61 | `server/validators/billing.validator.js` | service/helper only | no direct table access | total, subtotal, discount, tax, round, paid, wallet, split | required, validate, invalid, forbidden, tenant, branch | draft, paid, void, refunded, credit, cancelled | /pos, /pos/invoices, /pos/holds, /reports/invoices | Locked |
| 62 | `server/services/ai/posContext.service.js` | service/helper only | no direct table access | total, subtotal, discount, round, balance, paid, wallet | required, tenant, branch, active | paid, pending, credit, sent, active | /pos related | Locked |

## Calculation, validation and status lock

| Contract | Legacy owner | Rust parity requirement |
| --- | --- | --- |
| Integer paise only | billing/payment/calculation services | no float storage or rounding drift |
| Line item calculation | `invoice-calculation.service.js` | quantity, unit price, line discount type/value, GST, line total match |
| Bill calculation | `billing.service.js` | subtotal, bill discount, coupon discount, GST, tip, round-off, total and due match |
| Coupon/discount validation | billing route/service + validator | invalid, expired, ineligible, over-limit and duplicate-use outcomes match |
| Payment validation | payment collection/payment services | active mode, split total, overpayment, reference requirement and webhook/reconciliation states match |
| Invoice lifecycle | billing/invoice event/void services | draft, held, resumed, finalized, paid, refunded, voided and credit-note transitions are audit-safe |
| Wallet/credit validation | wallet/credit billing services | insufficient balance, debit/credit atomicity and tenant/client scope match |
| Membership/package/gift-card redemption | billing membership/package + gift-card routes | eligible credit only, no duplicate redemption, durable redemption record |
| Notifications | invoice notification/WhatsApp services | recipient validation, queue status, sent/failed result and history remain truthful |
| Due recovery | due recovery service | outstanding amount, ageing, assigned manager, follow-up note/call/reminder state remain durable |

## Migration completion checklist

- [ ] Every legacy route above has a Rust route and typed request/response mapping.
- [ ] Every listed durable table has a PostgreSQL migration or an explicitly approved consolidated equivalent.
- [ ] Every money field has old-vs-Rust paise comparison evidence.
- [ ] Every invoice status transition has allowed/blocked transition evidence.
- [ ] Draft hold/resume restores client, lines, discounts, coupon, payment split, wallet/credit redemption and references.
- [ ] Finalize is idempotent and does not duplicate payment, coupon usage, stock movement, redemption, invoice number or event records.
- [ ] Payment mode rules are enforced by backend, not only hidden in the Angular UI.
- [ ] Print/PDF and notification actions have durable action/delivery history.
- [ ] Due recovery report uses saved invoice/payment/follow-up data, not calculated UI-only state.
- [ ] Each Angular page/store/API caller is redirected to the matching Rust endpoint.
- [ ] Regression evidence is attached before a legacy source file is retired.

## Current Rust baseline

Existing Rust work covers basic POS sales, tenant/branch payment mode configuration, held invoice restore/finalize, invoice output action history, sales register and invoice reporting. Phase 2 DB contract is now mapped through `backend-rust/migrations/0019_pos_db_contract_completion.sql` for invoice sequences/snapshots, payment provider lifecycle, gift-card ledger, membership credit redemption and cash drawer ledgers. The legacy wallet, store credit, gift card, membership/package redemption, notification delivery, invoice ledger, refund/void/credit-note and due-recovery service logic remains locked as unmigrated until repository/service/API parity is completed.
