# POS Per-Domain Migration Checklist

Use this checklist in the locked domain order. `Existing` means the Rust endpoint is present today. `New` means the old behavior must be migrated before legacy retirement; it is not assumed complete.

## 1. Client, wallet and credits

| Status | Old Express endpoint -> Rust Axum endpoint | Old service -> Rust service/helper -> repository | Request -> response | Tables | Angular screen | Validation rule |
| --- | --- | --- | --- | --- | --- | --- |
| Existing | `GET /billing/customer/:customerId/history` -> `GET /pos/clients/:id/kpi` | billing client history -> `read_client_kpi` -> `clients`, `pos_sales`, `client_memberships` queries | path `clientId` -> name, phone, walletPaise, unpaidPaise, membership dates | `clients`, `pos_sales`, `client_memberships`, `memberships` | `/pos` KPI cards | tenant + branch must match client; never calculate a fake balance in Angular |
| Existing | old client create -> `POST /clients` | old client write -> `clients_repository::create` | firstName, lastName, phone, email, birthday, anniversary, notes -> saved client | `clients` | `/pos` inline client form | `firstName` required; branch comes only from request context |
| Existing | old wallet transaction APIs -> `POST /clients/:id/wallet-transactions`, `POST /clients/:id/wallet/recharge`, `/use`, `/refund` | wallet service -> `wallet_service::post_wallet_transaction` -> `wallet_repository` | clientId, type, amountPaise, referenceType, referenceId, idempotencyKey -> ledger row, balancePaise | `wallet_transactions`, `clients` | `/pos`, client history | atomic ledger + cached balance update; no negative balance; idempotency required; use/refund require source reference |
| Existing | old store-credit APIs -> `GET/POST /clients/:id/store-credits`, `POST /clients/:id/store-credits/:creditId/redemptions` | store-credit service -> `wallet_service` -> `wallet_repository` | source invoice/refund, amountPaise, expiry, idempotencyKey -> credit transaction, balance | `store_credits`, `store_credit_transactions` | `/pos` settlement | client/tenant/branch ownership; active/unexpired credit; immutable reference and idempotency required |

## 2. Service/product, tax, discount and coupon

| Status | Old Express endpoint -> Rust Axum endpoint | Old service -> Rust service/helper -> repository | Request -> response | Tables | Angular screen | Validation rule |
| --- | --- | --- | --- | --- | --- | --- |
| Existing | old catalog APIs -> `GET /services`, `GET /products` | catalog logic -> existing repositories | `q`, pagination -> service/product records | `services`, `products` | `/pos` line search | only active tenant/branch items can be billed |
| Existing | `POST /billing/invoices/:id/add-item` -> `POST /pos/invoices/:id/items` | invoice calculation -> `insert_calculated_line` -> `pos_sale_lines` SQL | lineType, itemId, staffId, staffSplits, quantity, pricePaise, discount type/value, gst -> calculated line | `pos_sales`, `pos_sale_lines` | `/pos` compact cart | quantity positive; service/product/custom/add-on line types only; empty staff split defaults to 100% primary staff; split rows must total 100; paise and GST calculated server-side; DB constraints added in migration `0021` |
| Existing | old coupon apply -> sale payload `couponCode` on `POST /pos/invoices/draft` or `POST /pos/sales`; admin `GET/POST /pos/coupons` | coupon engine -> `resolve_coupon_discount`, `consume_coupon_usage` -> `pos_coupons` | couponCode, sale lines/subtotal -> couponDiscountPaise, final totals | `pos_coupons`, `pos_sales` | `/pos` settlement | active window, minimum subtotal, usage limit, max discount and backend-created coupon rules enforced before finalization |
| Existing | old tax/discount/profit-guard APIs -> `GET/POST /pos/discount-rules` | invoice calculation service -> `enforce_discount_rules` -> `pos_discount_rules` | ruleType, active window, maxDiscountBps, maxDiscountPaise, minPayablePaise -> guarded pricing result | `pos_discount_rules`, `pos_sale_lines` snapshot | catalog settings and `/pos` | never trust line total from browser; preserve applied line discount snapshot; profit_guard/happy_hours rules reject discounts that exceed active backend caps |

## 3. Invoice draft, hold, resume and finalize

| Status | Old Express endpoint -> Rust Axum endpoint | Old service -> Rust service/helper -> repository | Request -> response | Tables | Angular screen | Validation rule |
| --- | --- | --- | --- | --- | --- | --- |
| Existing | `POST /billing/appointment/:appointmentId/draft` -> `POST /pos/invoices/draft` | billing draft -> `persist_pos_sale` -> `pos_sales`, `pos_sale_lines`, `pos_payments` | clientId, staffId, source, referenceId, lines, payments, discounts, coupon, tip -> draft invoice | `pos_sales`, `pos_sale_lines`, `pos_payments`, `pos_invoice_events` | `/pos` Hold | draft keeps cart, payment draft and references; tenant/branch required |
| Existing | old held invoice update -> `PUT /pos/invoices/:id` and `GET /pos/invoices/:id` | draft restore -> `replace_pos_invoice_draft`, `load_pos_sale_details` -> POS tables | same draft payload -> restored sale, lines, payments, KPI | POS tables | `/pos?draft=:id`, `/pos/sales?status=draft` | only a draft in the current tenant/branch can be replaced or resumed |
| Existing | `POST /billing/invoices/:id/finalize` -> `POST /pos/invoices/:id/finalize` | billing finalize -> `finalize_pos_invoice` -> POS tables/events | invoice id -> finalized invoice and totals | `pos_sales`, `pos_sale_lines`, `pos_payments`, `pos_invoice_events` | `/pos` Save | idempotent finalize; valid status transition; totals/payment validation and coupon usage are transactional |
| Existing | old held invoice resume -> `POST /pos/invoices/:id/resume` | held invoice resume -> `resume_pos_invoice` -> POS tables/events | invoice id -> restored held invoice details | `pos_sales`, `pos_sale_lines`, `pos_payments`, `pos_invoice_events` | `/pos?draft=:id`, held invoice list | only `draft` invoices can resume; event is recorded without changing durable totals |
| Existing | `/billing/invoices/:id/void`, `/refund`, `/credit-note` -> same `/pos/invoices/:id/*` actions | billing lifecycle -> POS lifecycle handlers -> lifecycle tables/events | reason/amount/idempotency -> updated invoice details | `pos_invoice_voids`, `pos_invoice_refunds`, `pos_credit_notes`, `pos_invoice_events`, `pos_sales` | `/pos/invoices`, invoice detail | void unpaid only; refund cannot exceed paid amount; credit note cannot exceed invoice total; idempotency keys prevent duplicate writes |
| New | old invoice number service -> invoice sequence endpoint/helper | invoice-number service -> `invoice_number_service` -> sequence repository | tenant/branch/invoice type -> next immutable invoice number | invoice-number sequence table, `pos_sales` | none | unique tenant + branch + invoice type number; never regenerate after finalization |

## 4. Payment split, active modes and references

| Status | Old Express endpoint -> Rust Axum endpoint | Old service -> Rust service/helper -> repository | Request -> response | Tables | Angular screen | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Existing | old payment mode settings -> `GET/POST /settings/payment-methods`, `PATCH /settings/payment-methods/:id` | payment-method settings -> `payment_methods_repository` | name, settlementType, shortcut, active, showOnInvoice, referenceRequired, sortOrder -> mode | `pos_payment_method_settings` | `/pos/payment-modes` | safe deactivate; unique code per tenant/branch; sort order is numeric |
| Existing | old active payment modes -> `GET /pos/payment-methods` | payment mode lookup -> `payment_methods_repository::list` | none -> active invoice-visible modes | `pos_payment_method_settings` | `/pos` settlement | checkout exposes active configured modes only |
| Existing | `POST /billing/invoices/:id/payment` -> `POST /pos/sales/:id/payments` | payment collection -> `validate_active_payment_modes`, `insert_pos_payments`, `settle_pos_internal_payment` -> POS payment SQL + wallet/store-credit/gift-card ledgers | method, amountPaise, methodReference, label, notes -> payment + split | `pos_payments`, `pos_sales`, `wallet_transactions`, `store_credit_transactions`, `gift_card_transactions` | `/pos`, `/pos/sales` | active mode required; reference required when configured; wallet/store-credit/gift-card are ledger-settled atomically; amount positive; tenant/branch/sale match; bank/online aliases normalize to `bank_transfer` |
| New | old provider link/webhook/reconciliation routes -> payment link/webhook/reconciliation Axum routes | invoice-payment collection -> provider helper -> payment-link repository | provider, amountPaise, provider payment/link/event IDs, signature -> link/event/reconciliation status | payment-link, payment-event, webhook, reconciliation tables | `/pos/invoices`, payments admin | unique provider event/idempotency key; webhook retries no-op; signature checked before state change |

## 5. Print, PDF and WhatsApp/email request history

| Status | Old Express endpoint -> Rust Axum endpoint | Old service -> Rust service/helper -> repository | Request -> response | Tables | Angular screen | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Existing | old print/PDF -> `GET /pos/invoices/:id/print`, `/pdf`, `/basic` | invoice print/PDF -> `get_pos_invoice_print` -> POS read helpers | invoice id -> `printHtml` | `pos_sales`, lines, payments | `/pos`, `/pos/invoices` | invoice must belong to current tenant/branch |
| Existing | old send request -> `POST /pos/invoices/:id/actions`, `/send`, `GET /pos/invoices/:id/history` plus billing/sales aliases | notification action history -> `record_pos_invoice_action` -> action history SQL + invoice event ledger | action/channel/recipient/idempotencyKey -> saved action; history rows | `pos_invoice_action_history`, `pos_invoice_events`, `notifications` | `/pos/invoices` | print/download/pdf/basic recorded; WhatsApp/email send requests require recipient; idempotency key prevents duplicate request rows |
| Existing request ledger | old notification queue/delivery routes -> invoice send request ledger | invoice notification/WhatsApp/email request -> action history + in-app notification row | invoiceId, channel, recipient, metadata -> queued request state | `pos_invoice_action_history`, `notifications` | `/pos/invoices` | request history persisted as queued; provider delivery/webhook can be added later when WhatsApp/email provider exists |

## 6. Due, unpaid, recovery, ageing and follow-up

| Status | Old Express endpoint -> Rust Axum endpoint | Old service -> Rust service/helper -> repository | Request -> response | Tables | Angular screen | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Existing | old invoice report -> `GET /reports/invoices` | due/read model -> `get_invoice_report` -> POS query | clientId, staffId, paymentMethod, status, recovery, ageingDays, followUp, dates -> report rows | `pos_sales`, `pos_payments`, clients/staff | `/reports/invoices` | report scope always from tenant/branch context; paise totals only |
| Existing | old due recovery follow-up routes -> `GET /reports/due-recovery`, `POST/GET /reports/invoices/:id/follow-ups` | due-recovery service -> follow-up helper -> `due_recovery_followups` SQL | invoiceId, actor, action, note, status -> follow-up record and ageing queue | `pos_sales`, `clients`, `due_recovery_followups` | `/reports/invoices` | outstanding invoice only; actor/time/status immutable audit fields |

## 7. Sales register and invoice reports

| Status | Old Express endpoint -> Rust Axum endpoint | Old service -> Rust service/helper -> repository | Request -> response | Tables | Angular screen | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Existing | old sales register -> `GET /pos/sales-register` | billing sales read -> `get_pos_sales_register` -> POS aggregate query | q, status, clientId, paymentMethod, dateFrom, dateTo, page -> rows, totals, pagination | `pos_sales`, `pos_payments`, clients | `/pos/sales` | tenant/branch scoped; totals must equal returned filter scope |
| Existing | old invoice list -> `GET /pos/invoices` and `GET /pos/invoices/:id` | billing read -> `list_pos_sales`, `load_pos_sale_details` -> POS read helpers | filters/id -> invoice, lines, payments, KPI | POS tables | `/pos/invoices` | no cross-branch invoice access |
| Existing | old invoice activity -> `GET /reports/invoice-activity` | invoice activity read -> event/action union SQL | date/status -> invoice events and action history | `pos_invoice_events`, `pos_invoice_action_history`, `pos_sales` | `/reports/invoices` | tenant/branch scoped event ledger only |
| Existing | old payment mode report -> `GET /reports/payment-modes` | payment mode aggregate -> POS payment SQL | date/method -> method totals, payment count, invoice count | `pos_payments`, `pos_sales` | `/reports/invoices` | paise sums from stored payment rows only |
| Existing | old cash drawer EOD -> `GET /reports/cash-drawer-eod` | cash drawer read -> drawer/session/payment aggregate SQL | business date -> opening, cash sales, cash in/out, refunds, expected/counted/variance | `cash_drawer_sessions`, `cash_drawer_movements`, `pos_payments`, `pos_sales` | cash drawer report | EOD expected cash is derived from durable cash payments and drawer movements |
| Existing evidence | old vs Rust parity evidence -> `GET/POST /reports/pos-parity` | parity capture -> evidence repository table | testCase, legacy/rust payload/result, matched, diff -> saved parity row | `pos_parity_runs` | internal parity checklist | no automatic old-server call; store approved comparison evidence after live payload compare |

## 8. Membership, package and gift-card redemption

| Status | Old Express endpoint -> Rust Axum endpoint | Old service -> Rust service/helper -> repository | Request -> response | Tables | Angular screen | Validation rule |
| --- | --- | --- | --- | --- | --- |
| Existing catalog | old membership/package settings -> existing membership/package CRUD routes | membership/package settings -> existing repositories | catalog fields -> catalog record | `memberships`, `packages` | membership/package pages | tenant/branch scope and active catalog record required |
| Existing | old membership/package redemption -> `membership`, `membership_redeem`, `package`, `package_redemptions` POS payload | billing membership/package service -> POS finalize helpers -> entitlement tables | invoice lines/redemption rows -> client membership/package credits, remainingQty, expiry, redemption rows | `client_memberships`, `client_membership_credits`, `pos_membership_redemptions`, `client_package_credits`, `pos_package_redemptions`, `pos_sale_lines` | `/pos` settlement | active, unexpired entitlement; remaining quantity cannot go negative; sale/finalize writes are transactional |
| Existing | old gift card sell/redeem -> `gift_card` POS line, `POST /pos/gift-cards`, gift-card payment method | gift-card service -> POS finalize/payment helpers -> gift-card ledger | code/value or invoice gift-card line -> card/transaction/balance; payment redeem -> balance decrement | `gift_cards`, `gift_card_transactions`, `pos_payments` | `/pos` add-on and settlement | unique code; idempotent issue/redeem; active/unexpired card; redemption cannot exceed balance |

## Rule for every migration row

- Axum handlers stay thin: validate request/context, call one helper/service, return typed response.
- SQL moves only into a repository. Existing direct POS SQL is the compatibility baseline; move it into a repository only while changing that behavior.
- Angular uses `ApiService`, reloads affected real data after mutation, and never recalculates durable paise balances locally.
- Before marking a `New` row complete, add its migration, typed model, route, helper/repository, UI screen, and one smallest behavior check.

## Parity verification gate before the next domain

Run the same approved input payload against the legacy Express/SQLite flow and the Rust/PostgreSQL flow. Compare normalized paise values, not floating-point display values.

| Compare | Must match |
| --- | --- |
| Invoice totals | subtotal, line discount, bill discount, coupon discount, GST/tax, tip, round-off, total and balance due paise |
| Client balances | wallet/store-credit/gift-card balance before and after, plus every ledger row and source reference |
| Invoice lifecycle | draft/held/resumed/finalized status, invoice number, lines, applied credits and event history |
| Payments | method, amount paise, reference, label, notes, payment count and paid/balance totals |

Required cases: normal sale, duplicate payment/idempotency retry, overpayment, inactive payment mode, invalid/expired/limited coupon, draft resume with lines and payments, and partial due.

A domain is marked `Migrated` only when every required case has matching business output, expected rejection where applicable, and no duplicate payment, ledger, coupon usage, or invoice event. Keep the captured payload, legacy response, Rust response, and database row counts with the checklist evidence.

## No big-bang replacement

- The old Express/SQLite backend remains the reference until every checklist row has passed parity verification.
- Rust/PostgreSQL is the source of truth only for a domain marked `Migrated` in this checklist.
- Do not route a partially migrated domain to Rust and then fall back to legacy for related writes; one completed domain has one durable write owner.
- Final cutover happens only after invoice draft/hold/resume/finalize and sales/invoice reports match the approved legacy cases.
