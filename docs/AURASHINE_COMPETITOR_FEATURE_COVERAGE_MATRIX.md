# AuraShine Competitive Feature Coverage

**Audit date:** 13 July 2026 · **Implementation update:** 15 July 2026

**Comparison:** AuraShine CRM vs Zenoti vs DINGG vs FlexiSalonERP

**Decision supported:** identify what is truly implemented in AuraShine, what is only partially wired, and the safest one-by-one implementation order.

## Executive Summary

- **AuraShine has seven source-confirmed core end-to-end strengths:** appointment operations, POS/invoice lifecycle, India GST/fiscal invoicing, client forms/consent, procurement, payroll/commission payout, and SaaS subscription/support administration. “Core end-to-end” does not mean full Zenoti/DINGG parity; advanced workflows and live-provider certification still remain.
- **Most of the product is partial:** 16 of 25 normalized capabilities have useful code but are missing an important workflow, layer, permission, UI, integration, or production verification path.
- **Two capabilities are backend-only from the Angular user's perspective:** public booking and inventory/backbar have meaningful Rust/PostgreSQL work but no usable complete frontend workflow.
- **No normalized capability is now completely absent from the active product surface.**
- **Enterprise RBAC, Appointment → POS handoff and ledger-safe inventory adjustments are now implemented.** Single appointments and active booking-group members share an idempotent invoice reference, retain booked service prices, and receive transactional `billed`/`paid` updates; manual inventory changes can no longer bypass the stock ledger.

### AuraShine audited status distribution

| Verdict | Capabilities | Meaning |
|---|---:|---|
| Core E2E | 7 | Functional Angular workflow, mounted API, and durable PostgreSQL path exist for the core workflow. |
| Partial | 16 | Useful implementation exists, but at least one required layer or material workflow is incomplete. |
| Backend-only | 2 | Rust/API/database capability exists, but there is no complete usable Angular workflow. |
| Missing | 0 | No normalized capability remains completely absent. |
| **Total** | **25** | Fixed denominator used throughout this report. |

### Zenoti strict 15-module parity

Zenoti ke 15 bade modules ko strict feature-for-feature dekhen to **0 module 100% complete, 12 partial aur 3 missing** hain. A module is counted as complete only when its material Zenoti workflows are usable across Angular, mounted Rust APIs, durable PostgreSQL data, permissions, and required provider integrations. This strict module view is intentionally tougher than the normalized 25-capability view above.

| Verdict | Modules | Share | Interpretation |
|---|---:|---:|---|
| Full Zenoti parity | 0 | 0% | No complete Zenoti module bundle is matched feature-for-feature. |
| Partial | 13 | 86.7% | Useful implementation exists, but one or more material workflows or layers remain incomplete. |
| Missing | 2 | 13.3% | No active production module exists for the Zenoti feature bundle. |
| **Total** | **15** | **100%** | Strict Zenoti module denominator. |

| # | Zenoti module | AuraShine status | Current source-confirmed strength | Highest remaining gap |
|---:|---|---|---|---|
| 1 | Appointment Book and scheduling | Partial — strong core | Calendar lifecycle, resources, conflicts, waitlist, groups, blackouts, booked prices and activity | Recurring/parallel bookings and nearby-branch slots |
| 2 | Service catalogue and pricing | Partial | Service CRUD, duration, price, tax and backbar recipe | Pricing tiers, variants, add-ons, dynamic pricing and required forms/resources |
| 3 | Online booking and digital channels | Partial | Public booking v1/v2 routes and token actions | Real OTP delivery, client reuse, deposits, widget/social/Google booking and recovery |
| 4 | Client CRM and guest profile | Partial | Basic profiles, dates, notes, wallet and billing KPI | Consolidated history, preferences, allergies, files, communication timeline and cross-location view |
| 5 | Digital forms, consent and check-in | Partial — forms missing | Appointment and QR check-in | Durable forms, signatures, waivers, conditional fields, kiosk and clinical records |
| 6 | POS, billing and payments | Partial — strong core | Transactional POS, appointment handoff, split payments, GST, refunds, credit notes, benefits and accounting | Saved-card billing, exchange, settlements and compliance worker |
| 7 | Memberships, packages, gift cards and loyalty | Partial | Rich lifecycle, grants, redemption, gift-card foundations and mapped enterprise mutations | Real auto-charge, transfer/freeze rules and complete loyalty/referral operations |
| 8 | Staff management, commission and payroll | Code complete / Activation pending | Profiles, roles, roster, attendance, self-scoped leave and punch actions, holiday-aware payroll, statutory calculation/export, provider-backed bank payout and employee payslips | Configure the real bank payout provider and pass one live settlement UAT |
| 9 | Inventory, backbar and purchasing | Partial | Stock, POS consumption, supplier master, PO approval, GRN, returns, payables, weighted cost and transfers | Inventory stocktake, batches/expiry, barcode labels and reorder automation |
| 10 | Marketing, communication and reputation | Missing | Isolated notifications and invoice delivery only | Leads, segments, campaigns, attribution, inbox, feedback and reputation workflows |
| 11 | Reports, dashboards and analytics | Core E2E / Activation pending | Operational reports plus a whitelisted Custom BI builder, pivot preview, saved definitions and scheduled email delivery | Inventory/retention/branch specialist analytics; configure the email provider and pass scheduled-delivery UAT |
| 12 | Multi-location and franchise control | Core E2E | Tenant/branch scoping, Region → Zone → Cluster hierarchy, central service/product masters, governed branch overrides, inventory transfer and POS-backed royalty accounting | Broader chain dashboard and commercial SaaS administration |
| 13 | Mobile apps and internal team tools | Partial — strong platform | Staff mobile dashboard/offline sync/device registration, customer form kiosk, staff punch kiosk, encrypted push subscriptions with retrying provider outbox, and durable realtime branch team chat | Native Android/iOS packaging, store signing/release and live push-provider credentials |
| 14 | AI features | Partial — application core complete | Governed header-based AI receptionist, real service-catalog grounding, durable transcripts/actions, human handoff, signed voice transcript adapter and verified WhatsApp inbound replies with secure booking continuation | Configure model, voice and WhatsApp providers; complete live call/number UAT and provider-specific audio transcription certification |
| 15 | Integrations, API and security | Partial | JWT/refresh, tenant middleware, signed provider webhooks and iCal | API keys, outbound webhooks, connectors, MFA/SSO, policy-backed RBAC and security administration |

**Appointment → POS correctness gate:** Complete, including atomic handoff, offline/group references and booked-price preservation.

## Scope and Evidence Rules

This is a **static source audit**, not a live production certification. “Wired” means the source calls a mounted endpoint; it does not prove that credentials, external providers, migrations, or runtime data currently work.

AuraShine was inspected at four layers:

1. Angular routes, pages, and API calls.
2. Rust Axum mounted routes, services, and repositories.
3. Python AI service endpoints and their integration boundaries.
4. PostgreSQL migrations and durable tables.

The active source wins over broad claims in [docs/README.md](./README.md). The inspected source inventory contains:

- 28 Angular route declarations and 23 page components.
- 29 page-domain folders that contain only `.gitkeep`.
- 27 Rust files under `backend-rust/src/routes/`, including router/context files.
- 15 service files, 20 repository files, and 59 PostgreSQL migrations.
- One small FastAPI module in [ai-service/main.py](../ai-service/main.py); it is not currently connected to the Angular app, Rust API, or PostgreSQL.

Competitor products are proprietary. Their frontend/backend/database internals cannot be audited from public material. Competitor cells therefore mean **officially published capability evidence**, not verified implementation quality or contractual entitlement.

### Status legend

| Mark | Meaning |
|---|---|
| `Core E2E` | Core workflow is source-confirmed across Angular, mounted API, and PostgreSQL. |
| `Partial` | Some real layers exist, but parity or production readiness is incomplete. |
| `Backend-only` | Rust/API/database exists without a complete Angular workflow. |
| `Missing` | No active source implementation found. |
| `Verify` | External credentials, provider behavior, statutory certification, or runtime proof is still required. |
| `H` | Competitor capability appears in current help/API/security documentation. |
| `M` | Competitor capability is an official marketing/product claim. |
| `L` | Official evidence is visibly legacy or stale. |
| `P` | Competitor public evidence supports only part of the capability. |
| `Ø` | No reliable official public evidence found. |

## Competitor Capability Baseline

The row numbers in this table map directly to the AuraShine layer audit in the next section.

| # | Normalized capability | Zenoti | DINGG | FlexiSalonERP |
|---:|---|---|---|---|
| 1 | Tenant, branch, multi-location | `M` Central multi-location enterprise platform. [Z1] | `M` Central branch management; commercial terms are per outlet. [D1][D4] | `P/L` Branch pricing and targets; no clear franchise hierarchy. [F1] |
| 2 | Services, pricing, rooms/resources | `M` Service and resource management. [Z1] | `H/M` Catalog, duration, staff and room scheduling. [D1][D2] | `L` Categories, duration, branch rates, room/station setup. [F1] |
| 3 | Appointment lifecycle | `H/M` Appointment book and operational workflows. [Z1][Z2] | `H` Calendar, multi-service, reassignment, status and checkout. [D2] | `L` Booking, multi-service, reschedule, check-in, cancel and no-show. [F1] |
| 4 | Walk-ins, waitlist and queue | `M` Waitlist and nearby availability. [Z1] | `H/M` Walk-ins and queue/booking limits. [D1][D2] | `P/L` Check-in and no-show; no verified waitlist engine. [F1] |
| 5 | Online/social/Google booking | `M` Webstore, social booking and Reserve with Google. [Z1] | `H/M` Web/QR booking and website/Facebook integrations. [D2][D6] | `Ø` No current public customer online-booking evidence. |
| 6 | Client CRM, history, family and notes | `H/M` Guest profiles and API-accessible data. [Z1][Z2] | `H` History, notes, family, invoices, benefits and points. [D2] | `L` CRM, spend/visit analysis, treatment history and outstanding balances. [F1] |
| 7 | Leads, enquiries and pipeline | `M` AI Lead Manager in the AI offering. [Z1] | `H` Enquiries and follow-up workflow. [D2] | `Ø` No public enquiry pipeline found. |
| 8 | POS, invoices, refunds, split payment and dues | `H/M` Integrated transaction platform. [Z1] | `H` Split/partial payment, discounts, cancellation, history and dues. [D2] | `P/L` Checkout-to-invoice and outstanding balances; refund/split depth unclear. [F1] |
| 9 | Payments, deposits, tips and UPI | `H/M` Payments, Text2Pay, tips and links; regional restrictions apply. [Z1][Z8] | `H/M` Cash, card, wallet, UPI, multiple modes and tips. [D1][D2] | `P/L` Bank/card support; no verified UPI or online gateway. [F1] |
| 10 | India GST and tax invoices | `H` GSTIN, PAN, state, HSN/SAC, tax groups and GST reports. [Z7] | `H/M` GST setup, tax groups, inclusive pricing and GST-ready bills. [D1][D2] | `L` Public page still lists VAT and Service Tax. [F1] |
| 11 | Memberships, packages and prepaid balances | `H/M` Memberships/packages and APIs. [Z1][Z2] | `H` Sale, redemption, service rules, points and prepaid value. [D2] | `P/L` Strong membership lifecycle; package authoring depth is unclear. [F1] |
| 12 | Gift cards, vouchers, loyalty and referrals | `M` Gift cards, loyalty, rewards and referrals. [Z1] | `H/M` Gift cards, vouchers, points and multi-location credits. [D1][D2] | `P/L` Detailed vouchers and loyalty reports; referral depth not shown. [F1] |
| 13 | Retail inventory and backbar consumption | `M` Inventory platform and optional AI inventory. [Z1] | `H` Stock history, issue, auto-consumption, adjustment and import/export. [D2] | `L` Retail/backbar, UOM/VOM, consumption, reorder, ledger and barcode. [F1] |
| 14 | Purchasing, suppliers, returns, transfers and audits | `M` Inventory/purchasing platform. [Z1] | `H/M` Suppliers, orders, receiving, adjustments and audits. [D1][D2] | `P/L` Suppliers, purchases, returns and physical adjustment; transfer unclear. [F1] |
| 15 | Staff roster, shifts, attendance and resources | `H/M` Scheduling, performance and room/resource assignment. [Z1][Z10] | `H/M` Roster, split shifts, attendance, goals and permissions. [D1][D2] | `L` Weekly off, attendance, service relation, shifts and biometric import. [F1] |
| 16 | Commission, payroll and tip payout | `H/M` Payroll, commission and tipping. [Z1][Z10] | `H` Salary, multilevel commission, payout and tips. [D2] | `L` Incentives, payroll generation and payslips. [F1] |
| 17 | Segmentation and campaign automation | `M` Marketing automation and AI Digital Marketer. [Z1] | `H/M` Segments and SMS/email/WhatsApp campaigns with tracking. [D1][D2] | `P/L` Bulk/triggered SMS and Excel import; no modern attribution proof. [F1] |
| 18 | Messaging, reminders, feedback and reputation | `M` Voice/SMS/messaging and reputation management. [Z1] | `H/M` SMS, email, WhatsApp, reminders, feedback and reports. [D1][D2] | `P/L` SMS confirmations/reminders; no verified WhatsApp/email/reputation flow. [F1] |
| 19 | Forms, consent, surveys and clinical records | `M` Forms/charting; exact plan scope must be confirmed. [Z1] | `H/M` Custom forms, feedback and consent surveys. [D1][D2] | `Ø` No public forms/consent workflow found. |
| 20 | Reports, analytics, BI and forecasting | `M` BI and AI advisor/retention/scheduling/inventory agents. [Z1] | `H/M` Operational reports, dashboards and AI trend claims. [D1][D2][D10] | `L` Broad static reports; no public forecasting or AI proof. [F1] |
| 21 | Mobile, kiosk, self-service and offline | `H/M` MyZen, Zenoti Mobile and kiosk; eligibility varies. [Z1][Z10] | `P/H` Business mobile apps; no clear kiosk/offline proof. [D7][D8][D9] | `Ø/L` Current mobile/kiosk/offline architecture is undocumented. |
| 22 | Security, RBAC, audit and compliance | `H` Encryption, RBAC, logs, backups, SSO and trust certifications. [Z5][Z6][Z9] | `P` RBAC/MFA/audit/DR claims; limited public assurance detail. [D5] | `Ø` No meaningful public security/compliance documentation. |
| 23 | APIs, webhooks and integrations | `H` Versioned API and webhooks; API package may be paid. [Z2][Z3][Z4] | `P/H` Named integrations; no public general API/webhook reference. [D2] | `Ø` No public modern API/webhook documentation. |
| 24 | Import, export and migration | `H/M` Assisted migration and APIs. [Z1][Z2] | `H` Client/service/inventory import-export. [D2] | `P/L` Excel/custom implementation, no standardized migration contract. [F1][F3] |
| 25 | Onboarding, support, SLA and pricing | `M` Quote-based plans, onboarding, training and 24/7 support. [Z1] | `M/Terms` No current public INR table; per-outlet prepaid subscription and no public SLA. [D4] | `P/L` Demo/training/customization; current pricing/deployment/SLA not public. [F1][F3][F5] |

## AuraShine Exact Frontend, API and Database Coverage

### Platform and CRM foundation

| # | Capability | Angular/frontend evidence | Rust/API evidence | PostgreSQL/data evidence | Verdict | Exact pending work |
|---:|---|---|---|---|---|---|
| 1 | Tenant, branch, multi-location | Header branch selector switches only among assigned branches; Settings manages branch CRUD, Region → Zone → Cluster hierarchy and the in-page Franchise Controls workspace. | Branch APIs provide audited hierarchy/policy writes, central service/product publication, field-level service override enforcement and idempotent royalty generation/payment. | Existing tenant/branch/access/catalog truth plus migration `0159` policy, linked-master and royalty statement fields/tables. | **Core E2E** | Wider consolidated chain dashboard, tenant onboarding and commercial SaaS administration remain separate phases. |
| 2 | Services, pricing, rooms/resources | `/services` CRUD and appointment resource/settings flows remain the operational editors; Franchise Controls selects one existing branch as the central service master source. | Central publish reuses existing services, links branch copies and preserves only explicitly allowed local overrides; normal service writes enforce the policy. | Existing `services` rows remain runtime truth; `central_master_service_id` and `franchise_override_fields` prevent a duplicate catalog. | **Core E2E** | Persisted service-chain/combo definitions remain an advanced catalog extension. |
| 3 | Appointment lifecycle | Strong calendar, multi-service, reschedule, status, blackouts, resources and realtime flows in [appointments-page.component.ts](../frontend-angular/src/app/pages/appointments/appointments-page.component.ts). | 46 route declarations in [appointments.rs](../backend-rust/src/routes/appointments.rs), plus [appointment_activity.rs](../backend-rust/src/routes/appointment_activity.rs). | `appointments`, activity, blackouts, settings and resources across migrations `0002`, `0028`, `0029`, `0031`, `0048`, `0049`, `0051`, with appointment/POS replay protection in `0064` and booked-price snapshots in `0074`. | **Core E2E** | Make remaining appointment/activity writes transactional, add core foreign keys and recurring/couple workflows. |
| 4 | Walk-ins, waitlist and queue | Waitlist and smart-booking actions are integrated into the appointment page. | Waitlist promotion, booking groups, queue prediction and QR check-in exist in [appointments.rs](../backend-rust/src/routes/appointments.rs). | `appointment_waitlist`, `booking_groups`, `smart_booking_requests`, `booking_wizard_state`. | Partial | Replace heuristic queue prediction, normalize group members, and add a durable capacity-aware front-desk queue. |
| 5 | Online/social/Google booking | No `/book` route; `pages/booking/` has no implementation. | Public v1/v2 booking and token actions exist in [booking_portal.rs](../backend-rust/src/routes/booking_portal.rs), [booking_portal_v2.rs](../backend-rust/src/routes/booking_portal_v2.rs), and [booking_extensions.rs](../backend-rust/src/routes/booking_extensions.rs). | Appointments plus Redis OTP/holds; no durable portal session, abandonment or deposit model. | Backend-only | OTP delivery is now provider-truthful, but production credentials/live-number certification, guest identity, deposits and social/Google flows remain pending. A new public page requires visual approval. |
| 6 | Client CRM, history, family and notes | `/clients` supports working search/create/edit, real histories, benefit summaries, structured complaint/recovery notes, durable family links and a Forms & consent workspace in [clients-page.component.html](../frontend-angular/src/app/pages/clients/clients-page.component.html). | Existing client detail returns the Client 360 aggregate; family compatibility routes now use the same tenant/branch-scoped repository instead of placeholders. | `clients`, `client_notes`, `client_family_links`, clinical profiles, immutable form versions/submissions, private treatment-photo bytes and the `last_visit_at` trigger. | **Core E2E** | Cross-location family policy remains an enterprise governance extension, not a missing core CRM workflow. |
| 7 | Leads, enquiries and pipeline | Existing `/marketing` Leads workspace now loads and mutates real lead records, stage/owner/qualification/score fields and an activity drawer. | Mounted `marketing_leads` router provides list/create/update, owner lookup, activity timeline, and appointment/client conversion actions with permission checks and audit events. | Migration `0199_marketing_lead_crm.sql` adds tenant/branch-scoped `marketing_leads` and `marketing_lead_activities` with stage, owner, score, follow-up, conversion and duplicate-active-phone protection. | **Core E2E** | Provider-driven nurture journeys, attribution reporting and automated follow-up delivery remain part of the Marketing Journeys phase. |

### Commerce, payments and retention

| # | Capability | Angular/frontend evidence | Rust/API evidence | PostgreSQL/data evidence | Verdict | Exact pending work |
|---:|---|---|---|---|---|---|
| 8 | POS, invoices, refunds, split payment and dues | Six POS routes cover checkout, sales, invoices, holds, tips and payment modes in [app.routes.ts](../frontend-angular/src/app/app.routes.ts); lifecycle actions are wired in [pos-page.component.ts](../frontend-angular/src/app/pages/pos/pos-page.component.ts) and [pos-invoices-page.component.ts](../frontend-angular/src/app/pages/pos/invoices/pos-invoices-page.component.ts). | Transactional sale/draft/finalize/payment/void/refund/credit-note/print/delivery/resume APIs in [pos.rs](../backend-rust/src/routes/pos.rs), including atomic appointment billing. | Extensive POS chain in migrations `0007`–`0046`, invoice appearance in `0056`, and appointment-source uniqueness in `0064`. | **Core E2E** | Split the 9k-line route into services/repositories; add approval UX, settlement dashboard and broader close-of-day workflow. |
| 9 | Payments, deposits, tips and UPI | Split payment, payment modes, tips, links and reconciliation are wired within POS. | Razorpay/Cashfree/PhonePe links and signed settlement exist; tokenized masked instruments, verified subscription autopay, no-show fee collection and Razorpay disputes are wired. Booking deposits remain mostly static/501. | Payment methods/events/links, reconciliation/refunds, `client_payment_instruments`, `payment_disputes`, no-show POS invoice and invoice compliance UI. | Code complete / Activation pending | Configure real provider credentials and verify one live capture, signed webhook, refund and dispute event. Build booking deposit collection in the Advanced Booking phase. |
| 10 | India GST and tax invoices | POS tax context plus invoice business/appearance settings and print/download UI. | GST engine, fiscal numbering, compliance queue and invoice profile logic in [pos.rs](../backend-rust/src/routes/pos.rs). | GST columns, fiscal sequences, invoice profiles, compliance settings/jobs in migrations `0034`, `0039`–`0041`, `0056`. | **Core E2E** | Add a real compliance worker/provider for IRN/e-way-bill and complete statutory/runtime certification; current jobs are queue-only. |
| 11 | Memberships, packages and prepaid balances | Strong `/memberships` and `/packages` workspaces use extensive enterprise APIs; existing Membership Settings now controls outbound/inbound cross-location sharing and hierarchy scope. | Membership/package lifecycle, self-service, family, plan change, reminders, risk, rewards and exports; Razorpay subscription reconciliation is worker-backed, while POS eligibility and service-credit redemption enforce verified cross-location policy. | Durable lifecycle and credit models across migrations `0006`, `0012`, `0018`, `0019`, `0050`, `0052`, `0054`, `0057`–`0059`; migration `0154` centralizes tenant/region/zone/cluster sharing enforcement. | Code complete / Activation pending | Configure real Razorpay credentials and verify one production renewal/webhook cycle. Enable sharing only on approved source and destination branches after verified client identity data is available. |
| 12 | Gift cards, vouchers, loyalty and referrals | Existing Client 360 Insights now provides wallet/prepaid controls, gift-card list/detail/actions, loyalty tier progress and referral workflow; Membership Settings owns configurable tier/referral rules. | Existing POS issue/redemption, wallet/store-credit and reward writers are reused; `/retention` adds scoped gift void/reissue/detail and idempotent referral completion with reward posting. | Existing financial/reward ledgers remain authoritative; migration `0109` adds gift reissue audit fields and tenant/branch-scoped referral code/referral records. | **Core E2E** | Add cross-location gift sharing, campaign voucher catalogs and provider-delivered referral invitations only when selected. |

### Inventory, purchasing and staff

| # | Capability | Angular/frontend evidence | Rust/API evidence | PostgreSQL/data evidence | Verdict | Exact pending work |
|---:|---|---|---|---|---|---|
| 13 | Retail inventory and backbar consumption | `/inventory` only renders `No records yet`; POS only reads products. | Inventory CRUD plus POS stock deduction/reversal and service recipes in [inventory.rs](../backend-rust/src/routes/inventory.rs), [services.rs](../backend-rust/src/routes/services.rs), and [pos.rs](../backend-rust/src/routes/pos.rs). | `inventory_items`, service recipe JSON and `inventory_stock_ledger`. | Backend-only | Build the existing `/inventory` page; add ledger-safe adjustments, stocktake, waste, reorder, batch/expiry, backbar consumption and ledger reads. |
| 14 | Purchasing, suppliers, returns, transfers and audits | Existing `/inventory` is now a compact Procurement workspace for suppliers, purchase orders, GRNs, returns, payables and transfers. | [purchases.rs](../backend-rust/src/routes/purchases.rs) exposes supplier, PO approval, GRN, return and payable/payment workflows; [inventory_transfers.rs](../backend-rust/src/routes/inventory_transfers.rs) remains the transfer engine. | Migration `0101` adds scoped supplier/PO/return/payment records and links GRNs to suppliers/POs while reusing the stock ledger and accounting journal. | **Core E2E** | Add barcode/label printing, transfer request approval and automatic cross-branch catalog mapping when those workflows are selected. |
| 15 | Staff roster, shifts, attendance and resources | Staff CRUD/profile/config, roster, attendance, leave and existing Staff OS self-service surfaces are wired. | Staff-role punches and leave reads/writes are forced to the linked employee profile; the self dashboard includes schedule, attendance, leave, payroll, holidays and protected payslips. | Staff profiles, schedules, attendance records/breaks, leave requests/balances, holidays and approval audit data. | **Core E2E** | Mobile-native packaging remains part of the separate Mobile/Kiosk phase. |
| 16 | Commission, payroll and tip payout | Existing Payroll workspace calculates commission, runs monthly payroll, manages a compact holiday calendar, supports review/finalize/provider payout and prints payslips. | Payroll preview/run/adjust/review/finalize plus atomic payout remain reused; bank method now submits an idempotent authenticated provider batch and marks paid only after a settled response. | Payroll runs/items/events, immutable POS commission snapshots, payout/accounting rows and migration `0155` paid-holiday data. | Code complete / Activation pending | Configure `PAYROLL_PAYOUT_PROVIDER_URL` and `PAYROLL_PAYOUT_PROVIDER_TOKEN`, then verify one live bank settlement. |

### Growth, communication and intelligence

| # | Capability | Angular/frontend evidence | Rust/API/Python evidence | PostgreSQL/data evidence | Verdict | Exact pending work |
|---:|---|---|---|---|---|---|
| 17 | Segmentation and campaign automation | Existing `/marketing` creates drafts/schedules, filters campaigns and shows real consent, delivery, booking-source attribution and provider readiness. | The existing notification worker builds consent-aware `all`, `active` and `at-risk` audiences, queues SMS/WhatsApp/email, retries delivery and rolls status counts into the campaign. | `notifications`, `benefit_notification_outbox`, client consent and appointment source data remain the shared truth; migration `0121` supplies durable campaign delivery. | **Core E2E** | Reusable template versioning and multi-step journey orchestration remain advanced extensions. |
| 18 | Messaging, reminders, feedback and reputation | Existing `/notifications` is a real client conversation inbox with WhatsApp/SMS replies; `/marketing` monitors stored Google/Facebook/Instagram/internal reviews. | [notifications.rs](../backend-rust/src/routes/notifications.rs) exposes inbox, replies, provider readiness and marketing insights; [invoice_delivery.rs](../backend-rust/src/services/invoice_delivery.rs) sends provider payloads; authenticated [invoice_webhooks.rs](../backend-rust/src/routes/invoice_webhooks.rs) records campaign receipts and inbound WhatsApp/SMS messages. | Migration `0157` makes SMS/marketing/provider conversations durable and idempotent while reusing client review links and appointment sources for reputation and attribution. | Code complete / Activation pending | Configure SMS webhook and WhatsApp Cloud credentials, complete live-number UAT, and select provider-specific Google/Facebook review sync only if automatic external polling is required. |
| 19 | Forms, consent, surveys and clinical records | Existing Client 360 creates form versions, conditional fields, signed staff/kiosk submissions, allergies/preferences, SOAP notes and treatment photos. | Tenant/branch-scoped form, clinical, SOAP and private media endpoints are implemented in [clients.rs](../backend-rust/src/routes/clients.rs); short-lived form-scoped kiosk delivery reuses the existing public-token boundary. | Migrations `0103` and `0152` add immutable form versions/submissions, versioned clinical profiles, SOAP records and access-controlled treatment-photo bytes. | **Core E2E** | Configurable clinical retention/deletion/export policy remains a later compliance extension. |
| 20 | Reports, analytics, BI and forecasting | Existing `/reports` contains Custom BI and Profit Copilot; the header now opens a governed AI Receptionist drawer, while Settings controls channels, confirmation, redaction, prompt version and transcript retention. | Custom BI remains source-backed; `/ai/concierge` persists web conversations, the signed voice adapter accepts provider transcripts, verified WhatsApp inbound messages receive governed replies, and Python uses structured model output with deterministic fallback. | PostgreSQL ledgers remain analytics truth; migrations `0158` and `0161` add scoped report definitions plus AI governance, transcripts and pending actions without letting the model write core CRM truth. | **BI Core E2E / AI application core / Activation pending** | Configure email/model/voice/WhatsApp providers and pass scheduled report, live call and live-number UAT. AI booking remains confirmation-gated through the existing public booking flow. |

### Product platform, security and portability

| # | Capability | Angular/frontend evidence | Rust/API evidence | PostgreSQL/data evidence | Verdict | Exact pending work |
|---:|---|---|---|---|---|---|
| 21 | Mobile, kiosk, self-service and offline | Existing Mobile Preview links the real staff self-service, staff punch kiosk, customer form kiosk and Team Chat workflows; Notifications now includes a realtime branch team channel. | Existing staff mobile dashboard/device/offline conflict APIs are joined by encrypted push subscription, retrying provider delivery and tenant/branch-scoped `/realtime/team-chat`; existing public form tokens remain the customer-kiosk boundary. | Existing staff mobile sync and form-submission truth is reused; migration `0160` adds encrypted push metadata, idempotent push outbox and durable branch chat without copying business data. | Partial — application core complete | Native Android/iOS projects, app-store signing/release and configured `MOBILE_PUSH_PROVIDER_*` credentials remain. |
| 22 | Security, RBAC, audit and compliance | Existing Security Center provides MFA, passkeys, Google/Microsoft OIDC, SAML federation policy, SCIM, audit, sessions, permission matrix, alerts, blocklist and policy controls. | JWT branch-scoped sessions, signed OIDC/SAML-broker assertions, PKCE/nonce/state validation, one-time login handoffs, role enforcement, TOTP, WebAuthn and session revocation are mounted. | Users, external identities, SSO policy, SCIM, branch assignments, refresh sessions, append-only auth audit, MFA/passkeys, alerts and blocks remain tenant scoped. | **Application core / Activation pending** | Configure provider credentials and complete live Google, Entra, SAML IdP and SCIM certification; production WAF and penetration certification remain external. |
| 23 | APIs, webhooks and integrations | Existing Integrations & Data page manages QuickBooks, Xero, NetSuite, Google Calendar, Zapier/API keys, one-time secrets, webhook subscriptions, OpenAPI export and Tally. | OAuth 2.0 plus PKCE connect/callback/disconnect, encrypted refresh tokens, durable connection-check jobs, scoped API keys, signed webhook retries/logs and Tally Z-report export reuse one integration boundary. | Migration `0162` adds tenant/branch connector authorization, one-time OAuth state and retryable sync jobs; API keys remain hashed and all connector secrets encrypted. | **Application core / Activation pending** | Configure real provider applications, authorize production accounts and pass provider-specific live sync/accounting certification. |
| 24 | Import, export and migration | Integrations & Data uses server results for client/staff dry-runs, row errors, progress, resume and confirmed rollback; local-only validation is no longer presented as completion. | Server parses quoted CSV, validates/deduplicates rows, persists jobs/errors, commits resumable 100-row batches and exposes rollback. | Import jobs retain row errors/progress; imported clients/staff carry a job identity so rollback deletes only records created by that job and respects dependency constraints. | **Core E2E** | Add service/product/inventory mapping only when those entity templates are approved; client and staff migration flow is complete. |
| 25 | Onboarding, support, SLA and pricing | Shared Appointment-baseline console gives platform admins plans, subscriptions, billing runs, usage, support and SLA controls; tenant owners/admins see their plan, real usage, invoices and support conversation. | Platform-only `/platform/saas/*` and tenant `/saas/*` APIs enforce separate RBAC boundaries, idempotent cycle billing/payments, real usage aggregation and SLA-aware ticket workflows. | Migration `0164` adds plan/SLA, subscription, usage-event, invoice/payment and immutable support conversation/event truth with tenant and branch scope. | **Core E2E / Provider activation pending** | Configure the selected SaaS payment provider credentials and schedule the idempotent billing-run endpoint in production. Manual/provider-reference billing remains usable without provider activation. |

## Critical Defects Before Feature Expansion

These are not competitor niceties; they affect correctness of code that already exists.

| Order | Severity | Defect | Source evidence | Required correction |
|---:|---|---|---|---|
| 1 | Resolved 13/07/2026 | Enterprise membership/package mutations could be rejected by RBAC. | [middleware/tenant.rs](../backend-rust/src/middleware/tenant.rs) now maps `/membership-enterprise`, `/package-enterprise` and `/booking-payments` to management writes. | Keep the focused authorization regression test passing. |
| 2 | Resolved 13/07/2026 | Appointment → POS was not an atomic handoff. | [appointments.rs](../backend-rust/src/routes/appointments.rs) now creates/resumes a real appointment-backed POS draft; [pos.rs](../backend-rust/src/routes/pos.rs) locks finalize retries and commits invoice, appointment `billed`/`paid` status and activity together; migration `0064` prevents duplicate appointment invoices. | Keep the focused success/retry/rollback database test passing. |
| 3 | Resolved in source 13/07/2026 | Public Booking v2 reported OTP sent without dispatching it. | [booking_portal_v2.rs](../backend-rust/src/routes/booking_portal_v2.rs) now calls the existing authenticated delivery webhook with a real SMS payload, clears an undelivered Redis OTP and returns `503` unless the provider accepts it. | Configure provider credentials and pass live-number end-to-end certification before production activation. |
| 4 | Resolved 13/07/2026 | Inventory quantity could bypass the stock ledger. | [inventory_adjustment_service.rs](../backend-rust/src/services/inventory_adjustment_service.rs) now locks the tenant/branch item and posts the stock delta plus immutable ledger row in one transaction; migration `0081` adds adjustment replay identity without a duplicate table. | Keep the focused success/retry/scope/rollback database test passing. |
| 5 | Resolved in source 13/07/2026 | E-invoice/e-way-bill workflow was queue-only. | [compliance_provider_service.rs](../backend-rust/src/services/compliance_provider_service.rs) now submits real invoice payloads through the configured provider worker; migration `0084` adds leased attempts, retry timing and provider results, while the existing compliance API exposes job status. | Configure a certified provider and pass live GSP/GSTN certification before production activation. |
| 6 | Resolved 13/07/2026 | Loyalty ledger lacked complete operational writers. | Existing POS earn/redeem posting is now joined by transactional refund reversal and an idempotent adjustment writer on the existing rewards-ledger API; migration `0086` preserves refund and adjustment replay identity. | Keep the focused adjustment/replay/refund/rollback database test passing. |
| 7 | Resolved 13/07/2026 | Placeholder endpoints overstated public-booking intelligence and operations. | [booking_extensions.rs](../backend-rust/src/routes/booking_extensions.rs) returns explicit `501 Not Implemented` for still-unbacked settings, token details, intelligence, analytics, deposits, SMS queue, jobs and family operations; client preferences now use the real Phase 2 profile store. | Add each remaining capability only with its real schema/provider and replace the corresponding explicit unsupported response. |

## One-by-One Implementation Order

The order below protects existing data and unlocks already-built work before adding large new domains.

### Gate A — Correctness and permission fixes

1. ~~**RBAC mutation mapping** for membership, package and booking-payment routes.~~ **Completed 13/07/2026.**
2. ~~**Real appointment-to-POS handoff** using the existing POS lifecycle.~~ **Completed 13/07/2026.**
3. ~~**Ledger-safe inventory adjustments** so stock truth cannot be overwritten silently.~~ **Completed 13/07/2026.**
4. ~~**Provider truthfulness:** booking OTP and e-invoice/e-way-bill provider workers.~~ **Completed in source 13/07/2026; production credentials and live certification remain pending.**
5. ~~**Loyalty ledger operational writers** for earn, redeem, refund reversal and manual adjustment.~~ **Completed 13/07/2026.**
6. ~~**Public-booking placeholder truthfulness** for unbacked intelligence and operations.~~ **Completed 13/07/2026.**

#### Appointment → POS handoff audit — P0, offline link, group billing and booked price completed 13/07/2026

**Current confirmed:** Appointment `Completed` now creates or resumes a server-side held invoice using real appointment, client, staff and service-catalogue data, then opens POS with the persisted draft id. `source='appointment'` plus `reference_id=<appointment id or booking_group_id>` is unique per tenant/branch. Consolidated groups reuse one sale, exclude cancelled/no-show members, and finalize/payment commits every active member's `billed`/`paid` status and activity in the same PostgreSQL transaction. New or replaced services capture their booked base price at the PostgreSQL boundary; direct POS, held-draft edits and offline replay reuse that price while discounts remain separate. Existing appointments are not falsely backfilled and retain current-catalogue fallback. **P0, offline-link P1, consolidated group billing and booked-price verdict: Complete.**

| Status | Implementation |
|---|---|
| Completed P0 | Real draft create/resume reuses the existing POS calculation and persistence path; no second sale engine was added. |
| Completed P0 | Appointment services are loaded by tenant/branch from the real catalogue with GST/SAC and assigned staff; base price comes from the booked snapshot with legacy current-catalogue fallback. |
| Completed P0 | Advisory transaction lock plus migration `0064` provide replay/idempotency protection; finalize is row-locked against concurrent retry. |
| Completed P0 | Finalize and payment commit appointment `billed`/`paid` plus immutable activity inside the POS transaction; the frontend no longer sends a post-commit status request. |
| Verified | Focused SQLx database test applies migration `0074` and covers snapshot capture, catalogue-price change, first success, duplicate reference/retry, paid transition and wrong-price rollback. |
| Completed P1 | Offline sync preserves appointment source/reference, keeps device replay identity in `offline_checkout_operations`, and no longer sends a post-commit status request that could regress `billed`/`paid` to `completed`. |
| Completed P1 | Consolidated booking groups use one canonical invoice reference; finalize verifies every service/staff line, active members transition together, cancelled/no-show members stay unchanged, and activity reporting resolves the shared invoice. |
| Completed P1 | Migration `0074` captures `serviceId → price_paise` without fake historical backfill; all appointment-sourced POS create/edit/offline paths hydrate it, and finalize rejects a changed booked base price while preserving discounts. |

#### Ledger-safe inventory adjustment audit — P1 completed 13/07/2026

**Current confirmed:** Existing `PATCH /inventory/:id` remains the only inventory edit API. Its `stockQuantity` field is now treated as an absolute adjustment target by a shared service: the item is locked by tenant/branch, negative stock is rejected, the signed delta and resulting balance are recorded in `inventory_stock_ledger`, and metadata plus stock commit atomically. Optional `idempotencyKey` prevents duplicate retry posting; `adjustmentReason` records the operator reason. Existing POS, purchase and transfer ledger paths remain unchanged. No duplicate route, table or frontend page was added.

| Status | Implementation |
|---|---|
| Completed P1 | Generic inventory metadata update no longer contains a direct `stock_quantity` overwrite. |
| Completed P1 | Migration `0081` extends the existing stock ledger with adjustment reason, resulting stock and a branch-scoped replay key. |
| Completed P1 | The focused SQLx test covers success, idempotent retry, tenant/branch scope, negative-stock rejection and transaction rollback. |

#### Public Booking OTP provider delivery — source implementation completed 13/07/2026

**Current confirmed:** Existing `POST /booking-portal/v2/otps/send` and Redis verification keys are reused. The endpoint sends the generated code through the configured authenticated `INVOICE_DELIVERY_WEBHOOK_URL` as an SMS provider payload. `sent: true` is returned only after a provider `2xx`; missing configuration or provider rejection returns `503`, and failed delivery removes the unusable OTP hash. No duplicate route, provider service, table or frontend page was added. Production activation remains blocked until real credentials and live-number end-to-end verification are supplied.

| Status | Implementation |
|---|---|
| Completed in source | Shared delivery transport is reused with `channel=sms`, recipient, code, purpose, language and five-minute TTL. |
| Completed in source | Missing configuration and provider failure are fail-closed; an undelivered code cannot be reported as sent. |
| Verified | Focused Rust test passed and the backend test binary compiled successfully. |

#### E-invoice/e-way-bill provider worker — source implementation completed 13/07/2026

**Current confirmed:** Existing compliance settings, queue, invoice status table and `GET /pos/invoices/:id/compliance` API are reused. The background worker claims due jobs with a lease, builds the payload from real POS invoice and line data, submits it to the authenticated provider endpoint with a stable idempotency key, and stores the provider reference/result. Failures retry after five minutes and become terminal after five attempts. The existing status API now includes attempts, retry time, provider reference, error and result; no duplicate route, queue table or frontend page was added. Production activation remains blocked until certified-provider credentials and a live GSP/GSTN verification path are supplied.

| Status | Implementation |
|---|---|
| Completed in source | A 60-second worker starts only when `COMPLIANCE_PROVIDER_URL` and `COMPLIANCE_PROVIDER_TOKEN` are configured. |
| Completed in source | `FOR UPDATE SKIP LOCKED`, a five-minute lease and a stable sale/document idempotency key protect retries and concurrent workers. |
| Verified | Focused SQLx test covers successful submission, duplicate completion, retry and terminal failure; 1 passed, 0 failed. |

#### Loyalty ledger operational writers — completed 13/07/2026

**Current confirmed:** Existing POS finalization paths already post membership reward earn/redeem entries while holding the client row inside the sale transaction. Refund now posts the proportional reversal inside the same invoice-refund transaction. The existing `GET /membership-enterprise/rewards/ledger` route also accepts `POST` adjustments with a required reason and replay key; it rejects zero points, reused keys with different payloads and deductions beyond the current balance. Migration `0086` adds refund and adjustment replay identity without creating a second ledger, route or frontend page.

| Status | Implementation |
|---|---|
| Completed P1 | Sale creation, payment finalization and explicit finalize reuse the existing earn/redeem writer and unique sale/type identity. |
| Completed P1 | Partial and full refunds calculate cumulative proportional reversal, cap the balance at zero and commit it with the refund. |
| Completed P1 | Manual adjustments reuse the rewards-ledger endpoint, lock the tenant/branch client and automatically remain visible in the existing Rewards table. |
| Verified | Focused SQLx test covers adjustment success/replay, partial/full refund reversal and insufficient-balance rollback; 1 passed, 0 failed. |

#### Public-booking placeholder truthfulness — completed 13/07/2026

**Current confirmed:** Unbacked handlers no longer claim `ready`, `queued`, `updated`, `linked`, `retried` or return authoritative-looking empty analytics. Booking settings, token details/reschedule options, intelligence, analytics, deposit calculation/reporting, SMS queue and appointment jobs fail closed with `501 Not Implemented`. Client preference aliases were upgraded to the real clinical profile store; client family aliases were later promoted to the durable `client_family_links` workflow in CRM Forms & Clinical Phase 3. Existing database-backed booking profiles, touch-ups, calendar tokens and appointment/waitlist routes were preserved.

| Status | Implementation |
|---|---|
| Completed P1 | One shared unsupported-response path prevents false `2xx` success across the placeholder handlers. |
| Preserved | Real booking profile, service/staff data, appointment touch-up and calendar-token persistence remain unchanged. |
| Verified | Focused Rust test checks representative settings, intelligence and job handlers; 1 passed, 0 failed. |

#### Client 360 Phase 1 — completed 14/07/2026

**Current confirmed:** The existing `/clients` page and routes are reused. Search now includes code, name, phone and email; create/edit keeps the current drawer and targeted reload flow. `GET /clients/:id` remains backward compatible while adding real appointment, invoice and service history plus summary values. Structured notes use the scoped `/clients/:id/notes` subresource. Migration `0099` adds the tenant/branch-scoped notes table and maintains `clients.last_visit_at` from completed, billed or paid appointments without inventing business data. No duplicate page, top-level route or client engine was added.

| Status | Implementation |
|---|---|
| Completed Phase 1 | Existing Client workspace now renders API-backed appointment, invoice, service and structured-note timeline entries. |
| Completed Phase 1 | Client detail aggregate and note writes enforce tenant/branch scope; legacy client fields remain compatible. |
| Verified | Focused SQLx scope/trigger test passed (1 passed, 0 failed) and the Angular production build passed. |

#### Client forms/consent Phase 2 — completed 14/07/2026

**Current confirmed:** The existing Client 360 page now has compact family, complaint/recovery, Forms/consent and Clinical/SOAP workflows. General family links use one tenant/branch-scoped relationship table and the already-mounted client/customer compatibility routes. Form definitions stay branch-scoped and immutable by version, support typed select fields and conditional visibility, and preserve signed staff or short-lived form-scoped kiosk submissions in the same submission table. SOAP drafts use optimistic versions and become immutable after finalization. Allergies/preferences keep their existing optimistic version checks. Photos reuse the authenticated raw-byte storage pattern with image MIME/5 MB validation and private tenant/branch/client-scoped retrieval. No new frontend route, duplicate page, dependency or fake record was added.

| Status | Implementation |
|---|---|
| Completed Phase 2 | Versioned consent/intake/treatment definitions and real client submissions are available on existing Client 360. |
| Completed Phase 2 | Allergies/preferences reject stale updates; signed evidence and treatment photos remain tenant/branch scoped. |
| Verified | Focused SQLx version/scope/media test passed (1 passed, 0 failed) and the Angular production build passed. |

### Gate B — Complete existing route surfaces

5. ~~**Client 360 Phase 1 on existing `/clients`:** working search/edit, appointment/invoice/service history, structured notes and `last_visit_at` update.~~ **Completed 14/07/2026.**
6. ~~**Client forms/consent Phase 2:** versioned forms, submissions, signatures, allergies/preferences and secure treatment photos.~~ **Completed 14/07/2026.**
7. **Inventory Phase 1 on existing `/inventory`:** item CRUD, ledger, adjustment, stocktake, reorder and backbar consumption.
8. ~~**Procurement Phase 2:** supplier master, purchase orders, GRN UI, returns, payables and transfers.~~ **Completed 14/07/2026.**
9. ~~**Staff operations:** attendance, leave approval, payroll run, commission payout and payslips.~~ **Completed 14/07/2026.**
10. ~~**Retention value:** gift-card administration, prepaid wallet UX, loyalty earn/redeem/tier rules and referrals.~~ **Completed 14/07/2026.**

### Gate C — New route-level products

11. **Public booking and client self-service.** Requires an Appointment-baseline image preview and explicit visual approval before a new route/page is created.
12. **Marketing, WhatsApp/SMS/email and leads.** Build after consent, segmentation and provider data models; new pages require visual approval.
13. ~~**Multi-location/security/franchise administration:** branch management, secure switching, per-user access, Region → Zone → Cluster hierarchy, central masters, governed overrides, royalty accounting, permission matrix, MFA/passkeys and audit/security controls.~~ **Core completed 15/07/2026.** Commercial SaaS administration and a new chain dashboard remain separate approval-gated work.
14. **Analytics and AI.** **Analytics core completed 14/07/2026** on the existing Dashboard with source-backed revenue forecasting. Real AI remains pending provider/model selection and credentials; deterministic helpers are not labelled AI.
15. ~~**Integration and migration platform:** OpenAPI, scoped API keys, signed webhooks, server CSV dry-runs/resume/rollback and Tally accounting export.~~ **Core completed 14/07/2026.** Live messaging activation remains deployment-credential dependent.

#### Procurement Phase 2 — completed 14/07/2026

**Current confirmed:** Existing `/inventory`, `/purchases`, inventory transfer, stock-ledger and accounting surfaces were reused. Suppliers are tenant/branch scoped; POs require submit plus separate approver identity; approved PO quantities are protected against over-receipt. GRN posting links supplier/PO, applies weighted stock and accounting atomically. Purchase returns prevent over-return and negative stock, reverse inventory/input GST/account payable in the same transaction, and supplier payments are idempotent and capped at the locked outstanding balance. The Angular workspace uses real APIs, compact tables, shared date pickers and right-side drawers; no duplicate page, route or stock engine was added.

| Status | Implementation |
|---|---|
| Completed Phase 2 | Supplier master, PO creation/approval, PO-backed GRN, returns and payable settlement are durable and tenant/branch scoped. |
| Completed Phase 2 | Existing dispatch/receive/cancel transfer engine is available in the Procurement workspace. |
| Verified | Angular production build and backend `cargo check` passed. |

#### Multi-location/Security core — completed 14/07/2026

**Current confirmed:** Existing Settings, Staff, header branch selector and Security Center surfaces were reused. Owners can create, edit, activate and deactivate tenant branches; users switch only to active explicit branch assignments and receive a new branch-scoped token. Staff branch roles, custom permission sets, MFA, passkeys, sessions, audit events, alerts, blocks and security policy remain API-backed. The branch handler now accepts the same scoped `settings.read`, `settings.manage` and legacy compatibility permissions already enforced by route middleware, closing the custom-role double-gate mismatch without adding a page, route or table.

| Status | Implementation |
|---|---|
| Completed core | Branch management, login selection, live switching and explicit user/role branch assignments are durable and tenant scoped. |
| Completed core | Permission matrix, role management, MFA/passkeys, session revocation, audit viewer, alerts, blocklist and policy controls are wired. |
| Advanced pending | Broader consolidated chain dashboards and live SSO certification require separately approved workflows. |
| Verified | Focused branch permission-alignment test passed (1 passed, 0 failed). |

#### Analytics core — completed 14/07/2026; real AI pending

**Current confirmed:** Existing Dashboard and report permission boundary were reused. `GET /reports/revenue-forecast` loads a gap-free daily series from tenant/branch-scoped finalized POS sales through a repository, calculates a transparent three-day moving average in the Rust service, and renders the next seven days without changing KPI card dimensions or adding a page. Empty source data stays empty/zero. The isolated Python helpers are still deterministic and no OpenAI/Azure/other model credentials are configured, so the product does not claim an AI forecast.

| Status | Implementation |
|---|---|
| Completed analytics | Real appointment, sales, payment, due and activity analytics remain on the existing Dashboard; revenue forecast now uses complete PostgreSQL daily totals. |
| Completed analytics | Forecast method/source are explicit, tenant/branch scoped and contain no invented confidence or growth values. |
| AI pending | Select a real provider/model, credentials, allowed workflows, persistence and evaluation policy before model-backed output is added. |
| Verified | Focused forecast test passed (1 passed, 0 failed) and Angular production build passed. |

#### Staff Operations — completed 14/07/2026

**Current confirmed:** Existing staff attendance, leave-management, Staff OS and payroll pages/routes are reused. Staff-role punches and leave requests are now forced to the linked employee profile. Branch holiday CRUD feeds paid-holiday days into the monthly payroll snapshot without double counting attended, leave or weekly-off dates. Bank payout calls the configured authenticated provider with a stable idempotency key and real finalized staff amounts, then records payout/accounting only after a settled provider response. Self-service exposes schedule, attendance, leave, payroll, holidays and protected source-backed payslips without a duplicate page.

| Status | Implementation |
|---|---|
| Completed | Attendance, leave approval, payroll calculation/review/finalize and commission calculation reuse existing services. |
| Completed | Paid-holiday calculation, linked-employee self-service, protected payslips and settled provider payout reuse existing staff/payroll surfaces. |
| Verified | Focused holiday/provider/payout test passed (1 passed, 0 failed) and backend `cargo check` passed. Frontend build command is handed to the user per repository policy. |

#### Retention Value — completed 14/07/2026

**Current confirmed:** Existing POS gift issuance/redemption, wallet/store-credit APIs and loyalty earn/redeem/refund/adjustment writers were reused. Client 360 now exposes real prepaid balances, gift list/detail/void/reissue, loyalty tier progress and referral operations without a duplicate route-level page. Gift mutations and referral reward completion are tenant/branch scoped, transactional and replay safe; configurable tier thresholds and referral rewards remain in the existing Membership Settings document.

| Status | Implementation |
|---|---|
| Completed | Gift-card administration and prepaid wallet controls are wired to existing ledgers and reload Client 360 after each action. |
| Completed | Configurable loyalty tiers, durable referral codes/links and idempotent completion rewards are available. |
| Verified | Focused loyalty-tier test passed, backend `cargo check` passed, and Angular production build passed. |

#### Laundry Tracker — optional module completed 15/07/2026

**Current confirmed:** The existing Inventory domain and supplier/client masters are reused. The Appointment-baseline operational page provides salon or client intake, in-house/vendor routing, item quantities and branch-unique barcodes, due/overdue tracking, controlled wash/outsource/QC/rework/ready/return transitions, issue charges/resolution and an immutable custody event history. All durable rows and reads are tenant/branch scoped; no demo business records are used.

| Status | Implementation |
|---|---|
| Completed | Intake, item register, barcode lookup, SLA summary, vendor association and order detail are API-backed. |
| Completed | Workflow transitions, issue reporting/resolution and matching item/order state changes are transactional and audit recorded. |
| Completed | Angular route and Inventory navigation use the existing shell, shared date picker, compact tables and right-side drawer patterns. |
| Verified | PostgreSQL migration apply/rollback passed, focused workflow test passed (1 passed, 0 failed), backend `cargo check` passed and Angular type-check passed. |

#### SaaS Subscription & Support — optional module completed 15/07/2026

**Current confirmed:** One shared console serves platform and tenant contexts without duplicating business logic. Platform super-admins manage plan pricing/allowances, four-severity SLA policies, tenant subscriptions, idempotent billing cycles, invoice payments, usage and the global support queue. Tenant owners/admins see their current plan, source-backed branch/user/appointment usage, invoices and customer-visible ticket conversations. Business-hours SLA deadlines use IST and skip Sunday; internal support notes never appear in tenant responses.

| Status | Implementation |
|---|---|
| Completed | Plans, version-safe edits, subscription lifecycle, trials, provider references and period-end cancellation are durable. |
| Completed | Real usage aggregation, append-only custom usage events, overage calculation, cycle invoices, overdue/past-due transition and replay-safe payments are wired. |
| Completed | Tenant ticket creation/replies, platform assignment/status/internal notes, immutable events and SLA breach calculation are wired. |
| Verified | PostgreSQL migration apply/rollback passed, focused usage/SLA tests passed (2 passed, 0 failed), backend compile passed and Angular type-check passed. |
| Activation pending | Real Razorpay/Stripe SaaS credentials and a production schedule for `/platform/saas/invoices/run` are deployment configuration, not missing application code. |

#### SALON-NEWW online booking and apps intake — source audit added 15/07/2026

**Reference snapshot:** [`aftabpthn/SALON-NEWW`](https://github.com/aftabpthn/SALON-NEWW) `main` at commit `9b490a1`. This is a feature/reference audit only; no Express, SQLite, Angular, Ionic or demo-data source was copied into AuraShine.

##### Frontend lane — separate and visual-approval gated

| Reference surface | AuraShine reuse target | Current decision |
|---|---|---|
| Direct web booking | Existing `/book/:tenantSlug` and `frontend-angular/src/app/pages/booking/public-booking-page.*` | Existing approved page improved in place; no duplicate booking route or payment engine was created. |
| Fresha/Salonist-style customer marketplace app | Existing customer-safe Rust marketplace/auth APIs and the standalone `customer-app` product surface | Existing app audited and wired to real AuraShine contracts. Demo fallbacks and hardcoded pay-at-venue behavior were removed; Android and iOS projects now exist. |
| Customer rewards, wallet, memberships, packages, gift cards, payments and invoices | Existing retention, membership, package, POS/payment and customer portal contracts | Reuse current APIs and ledgers. Never show local demo fallback when an API returns no rows; render a real empty state. |
| Staff operations app | Existing `/staff-os`, staff attendance, leave, payroll, realtime team chat and mobile push paths | Existing standalone `staff-app` reuses the current permission-scoped APIs. Secure shell caching and Android/iOS packaging are now present; no parallel staff backend was added. |

##### Backend lane — Rust/PostgreSQL reuse first

| Capability from reference repo | Existing AuraShine backend target | Intake status |
|---|---|---|
| Public profile, services, staff, slots, holds, OTP, multi-service timeline, quote, confirm, my bookings and abandonment sessions | `booking_portal.rs`, `booking_portal_v2.rs` and the mounted booking services | Foundation already exists. Audit the exact missing behavior before adding handlers; no parallel `/booking-portal` engine. |
| Customer OTP/email auth, profile, sessions, marketplace businesses/categories, services, staff, reviews, membership plans, availability, booking, cancellation and rescheduling | `customer_portal.rs` and `customer_portal_service.rs` | Foundation already exists. Preserve customer-safe auth and tenant/branch scope. |
| Booking deposits, online payment, payment status, refund and webhook | Existing quote/confirm flow, payment gateway/Razorpay services, POS payment and webhook infrastructure | Connect only missing customer-facing orchestration. Payment mode must be returned by server capability; do not hardcode `pay_at_venue`. |
| Wallet, loyalty, memberships, packages, gift cards, invoices and payments | Existing durable ledgers and retention/POS services | Map customer-safe read/write contracts to current tables and transactions; do not introduce a customer-app database. |
| Booking funnel, recovery, no-show/churn/rebooking and upsell intelligence | Existing reporting, engagement, happy-hours and governed AI surfaces | Add only source-backed missing metrics or actions after a focused parity audit. Deterministic rules must not be labelled AI. |
| Staff attendance, roster, performance, payroll, leave, notifications and chat | Existing staff, payroll, realtime and team-chat services | Reuse current permission-scoped routes. Do not port demo staff-session behavior. |

**Explicit exclusions:** fake customer/staff/account records, demo fallback data, hardcoded LAN API URLs, blank credentials presented as live and a second booking database. Provider credentials, native build synchronization and store signing remain activation/distribution work, not application-complete claims.

**Implementation gate:** backend parity/API mapping first. The existing Public Booking visual and the already-present customer/staff app surfaces were approved for implementation; any genuinely new route-level screen remains separately approval gated.

##### Web Booking Phase 1 — payment and customer self-service completed 15/07/2026

| Area | Verified implementation |
|---|---|
| Deposit/payment | Booking confirmation persists the authoritative booked-price snapshot, calculates the branch deposit from server data, creates an idempotent Razorpay payment link and exposes real issued/paid/expired/cancelled/failed/refunded status. |
| Webhook/reconciliation | The existing signed Razorpay webhook is reused. Provider events are deduplicated, payment and appointment confirmation update transactionally, and manual status refresh reconciles the provider state. |
| Refund | Paid deposits use a provider-safe idempotency key, durable refund record and appointment activity. Missing Razorpay credentials remain an explicit live-activation blocker instead of a fake success. |
| My Bookings | The existing `/book/:tenantSlug` page stores only short-lived customer action tokens in session storage, loads API-backed bookings, and provides owner-scoped cancel, reschedule, payment refresh and eligible refund actions. No demo booking records are shown. |
| UI | The existing Appointment-baseline page was extended; no duplicate route/page was created. Confirmation, payment actions, compact booking records, empty/loading/error states and the right-side reschedule drawer are responsive. |
| Verification | Backend `cargo check`, direct Angular TypeScript check, Angular template compiler and `git diff --check` pass. The focused Rust test command exceeded the local five-minute limit; provider E2E remains pending real Razorpay credentials and webhook delivery. |

##### Three-product completion update — audited and wired 15/07/2026

| Product | Completed application work | Exact remaining boundary |
|---|---|---|
| Web Online Booking | Existing payment/self-service flow retained. Durable funnel sessions/events, conversion/abandonment state, source-backed no-show/churn/rebooking metrics and idempotent recovery delivery now use PostgreSQL and the shared provider service. Verified mobile is stored separately and removed from analytics event JSON. Cloudflare Turnstile is capability-driven in the public response, rendered only when configured and always validated server-side before OTP delivery. Existing variants/add-ons remain the customer-safe upsell UI; individual risk scores stay staff-protected by design. | Live Turnstile, Razorpay, OTP and recovery delivery require production credentials/webhooks and provider E2E verification. |
| Customer App | Marketplace endpoints now match the Rust contracts; real services/staff/availability, capability-driven payment mode, booking payment-link retry, customer-owned history and account ledgers are wired. Membership purchase, gift-card purchase/redeem and invoice payment links now reuse the existing POS, membership, gift-card, accounting and signed-webhook transactions. Favorites, waitlist, reviews, support tickets, referrals, family profiles, corporate benefits, private gallery metadata and beauty goals are durable/customer-owned. Demo fallback rows were removed. Android and iOS projects exist. | Production payment/Firebase/push credentials, native sync/signing and store release remain activation/distribution. |
| Staff App | Existing secure auth and offline mutation queue were retained. A PWA manifest/service worker now caches only shell/static files and never API/business data. Android and iOS Capacitor projects exist and reuse the current Staff APIs. | Native build sync/signing, Apple/Google store setup, production push credentials and device certification remain distribution work. |

**Verification:** Direct TypeScript checks and Angular template compilation pass for the main frontend, Customer App and Staff App. Rust `cargo check` passed after the customer/recovery changes; the final Turnstile retry was blocked by a concurrent partial `reports.rs` edit (`report_advanced_summary` route observed before its handler was written), not by a changed booking file. `git diff --check` passes. No demo business records were introduced.

##### Customer Commerce Phase 1 — implementation complete 15/07/2026; focused test gate blocked

| Area | Verified implementation |
|---|---|
| Membership checkout | Customer-safe plan ownership, authoritative branch price and membership tax policy feed an idempotent POS invoice. Paid/free plans activate through the existing membership-credit transaction; unpaid plans do not grant benefits. |
| Gift-card checkout | The customer chooses a real marketplace branch and amount. The existing POS sale and gift-card ledger issue the card only after full verified payment; no pending/demo card is inserted. |
| Invoice payment and gift-card redemption | Customer invoice/card ownership, tenant/branch scope, payable balance, active status and replay key are validated. Gift-card balance, POS payment, invoice status and accounting update in one existing transaction. |
| Provider settlement | Razorpay, Cashfree and PhonePe signed webhook paths call one idempotent deferred-benefit settlement helper inside the payment transaction. Missing provider/webhook credentials return explicit activation-required/service-unavailable state. |
| Customer UI | Existing Customer Hub reuses real marketplace branches and account invoices, exposes secure payment actions and reloads API-backed records after activation/redemption. No new route/page or local fallback record was added. |
| Verification | Rust formatting/source parse and `cargo check` pass. Customer App direct TypeScript and Angular template compiler checks pass. Focused deferred-benefit/value policy tests are included; their current test-binary build is blocked by the unrelated concurrent `analytics_service.rs` test reference to missing `block_unreconciled_recommendations`. |

##### Customer Support/Profile Phase 2 — implementation complete 15/07/2026; backend cargo gate pending

| Area | Implementation |
|---|---|
| Support | Customer-owned support tickets and customer messages now persist in dedicated customer portal tables, scoped through the authenticated customer account and linked branch/client context. |
| Referrals | Customer app can load existing referral code/history and create a branch-scoped referral code through the existing retention referral service. |
| Family, corporate and gallery | Existing CRM family links, POS corporate account members and private treatment-photo metadata are exposed as read-only customer-owned views. No duplicate CRM/POS tables were added. |
| Beauty goals | Customer-owned beauty goals persist with branch/client scope, type, target date, notes and status. |
| Customer UI | Existing Customer Hub loads support/referrals/family/corporate/gallery/goals from real APIs. Support ticket, referral-code and beauty-goal actions reload the affected API-backed module. Gallery now uses the hub instead of the wishlist page. |
| Verification | Customer App direct TypeScript check and Angular template compiler pass. Rust formatting passes. Backend `cargo check` was blocked by repeated concurrent `cargo check`/`cargo run` compilation processes and needs one clean rerun. |

**Current three-product position:** the high-value shared foundation, core booking/mobile workflows, customer commerce and customer-safe support/profile extensions are implemented. Provider credentials, native-store release and one clean backend cargo verification rerun are tracked separately from application backlog.

##### Dedicated Lead CRM Phase — implementation complete 15/07/2026

| Area | Verified implementation |
|---|---|
| Durable lead model | Migration `0199_marketing_lead_crm.sql` adds tenant/branch-scoped leads with source, stage, qualification status, score, owner, follow-up date, optional client/appointment links and notes. Active phone duplicates are rejected per tenant/branch. |
| Activity timeline | Lead notes, calls, messages, follow-ups, qualification and conversion activities persist in `marketing_lead_activities`; activity writes and follow-up updates are transactional. |
| API and security | Existing Marketing Leads surface reuses `GET/POST/PATCH /marketing/leads`, owner lookup, activity timeline and conversion endpoints. Owner/client/appointment references are branch-validated; marketing/client permissions and audit events are enforced. |
| Frontend | Existing `/marketing` page now uses real lead APIs, empty/loading/error states, stage and owner controls, score/qualification fields, activity drawer and conversion action. No duplicate page or route was created. |
| Boundary | Automated campaign journeys, provider delivery, attribution analytics and reputation automation remain separate Marketing phase work; this phase does not claim live provider activation. |

### Recommended immediate slice

**Immediate implementation backlog:** no known SALON-NEWW application phase remains in this slice. Provider credentials, native sync/signing, store release, live certification and a clean backend cargo verification rerun are separate activation/distribution/verification work.

## Further Decisions Needed

1. AuraShine now supports the commercial multi-tenant SaaS layer; final plan prices, tax treatment and payment-provider account remain business configuration.
2. Which real communication provider will be used first: WhatsApp Cloud, SMS, or email? Provider credentials and consent rules are required before activation.
3. What retention/export/deletion period should apply to signed forms and treatment photos?
4. Should payroll be a full statutory India payroll engine or an approved export to an external payroll system?
5. Laundry workflow is now confirmed and implemented. Biometric workflows still require an operational and privacy decision.

## Caveats and Assumptions

- “FlexiSalon” means **FlexiSalonERP by SoftMark**. No reliable product matching the earlier spelling “Flixe” was found.
- FlexiSalonERP evidence is official but visibly stale: its page footer is ©2019 and it still lists VAT/Service Tax. Current cloud, mobile, GST, security, pricing and API claims require a live demo and written confirmation.
- Zenoti and DINGG plan entitlements, regional availability, usage charges and add-ons can change. Their cells show public evidence, not procurement guarantees.
- Razorpay, WhatsApp, OTP and statutory workflows are not considered production-ready without real credentials and successful end-to-end verification.
- No fake clients, appointments, payments, staff, services, inventory or reports were created for this audit.
- No live business-data mutation, browser/provider certification or production migration was performed; focused isolated SQLx verification is called out above.

## Official Competitor Sources

### Zenoti

- [Z1 — Current pricing and capability catalog](https://www.zenoti.com/pricing-zenoti)
- [Z2 — API overview](https://docs.zenoti.com/docs/overview)
- [Z3 — Webhooks overview](https://docs.zenoti.com/docs/overview-1)
- [Z4 — API authentication](https://docs.zenoti.com/docs/authentication)
- [Z5 — Security](https://www.zenoti.com/en-uk/trust/security)
- [Z6 — Trust Center](https://trust.zenoti.com/)
- [Z7 — India GST configuration](https://help.zenoti.com/en/configuration/finance-gst-configurations/gst---india.html)
- [Z8 — Payment links](https://help.zenoti.com/en/configuration/zenoti-payments-configurations/payment-settings/speed-up-checkouts.html)
- [Z9 — Security roles and permissions](https://help.zenoti.com/en/configuration/security-configurations/default-security-roles-and-permissions.html)
- [Z10 — MyZen mobile app](https://help.zenoti.com/en/myzen/get-started-with-myzen-app.html)

### DINGG

- [D1 — India product page](https://dingg.app/in)
- [D2 — Public help center](https://docs.dingg.app/)
- [D3 — Official brochure](https://img.dingg.app/dingg-brochure.pdf)
- [D4 — Terms](https://dingg.app/terms)
- [D5 — Privacy policy](https://dingg.app/privacy-policy)
- [D6 — Online booking](https://dingg.app/features/salon-online-booking-system)
- [D7 — Business Android app](https://play.google.com/store/apps/details?id=app.dingg.vendor&hl=en_IN)
- [D8 — Business iOS app](https://apps.apple.com/us/app/business-dingg/id1451484232)
- [D9 — Customer Android app](https://play.google.com/store/apps/details?id=app.dingg.user&hl=en_IN)
- [D10 — Separate DINGG AI pricing surface](https://dingg.ai/pricing)

### FlexiSalonERP

- [F1 — Detailed official feature page](https://www.softmark.in/FlexiSalon.html)
- [F2 — Product tour](https://www.softmark.in/Product_Tour.html)
- [F3 — Customization and support](https://www.softmark.in/Customization.html)
- [F4 — Implementation methodology](https://www.softmark.in/Methodologies.html)
- [F5 — Company and deployment context](https://www.softmark.in/Aboutus.html)
- [F6 — Official brochure](https://www.softmark.in/pdf/FlexiSalon_Brochure.pdf)
