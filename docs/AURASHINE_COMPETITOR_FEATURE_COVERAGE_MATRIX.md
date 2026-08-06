# AuraShine Competitor Feature Coverage

**Evidence refresh:** 6 August 2026

**Scope:** AuraShine vs Zenoti, Salonist and DINGG

**Rule:** source candidates are not implementation proof; production activation is not source completion.

## Atomic parity baselines

| Competitor | Official atomic rows | Aura evidence already accepted | Ranked source review | Current gate |
|---|---:|---:|---|---|
| Zenoti | 2,616 | 55 Complete | 2,561 rows: 822 high, 1,227 medium, 100 schema-only, 181 low, 231 no-match | Human evidence review and authenticated UAT |
| Salonist | 299 | 0 | 299 rows: 83 high, 172 medium, 12 schema-only, 21 low, 11 no-match | Human evidence review and authenticated UAT |
| DINGG | 217 | 0 | 217 rows: 93 high, 108 medium, 1 schema-only, 10 low, 5 no-match | Human evidence review and authenticated UAT |

Registers and full worklists:

- [Zenoti master register](./ZENOTI_MASTER_PARITY_REGISTER.md) · [triage](./ZENOTI_PARITY_TRIAGE.md)
- [Salonist master register](./SALONIST_MASTER_PARITY_REGISTER.md) · [triage](./SALONIST_PARITY_TRIAGE.md)
- [DINGG master register](./DINGG_MASTER_PARITY_REGISTER.md) · [triage](./DINGG_PARITY_TRIAGE.md)

The old 25-row snapshot and its July source inventory are retired. Current source discovery covers 1,545 mounted backend route literals, 241 mounted-route/service/repository modules, 123 frontend pages/components, 592 database tables and 135 focused frontend tests. The candidate matcher never changes a parity status.

## Current product coverage

| Capability | Current AuraShine position | Highest remaining gate |
|---|---|---|
| Appointment calendar and booking | Substantial source foundation: recurring, parallel, segmented, couple, group/large-group, resources, capacity, waitlist, deposits and lifecycle operations | Authenticated UI/API/RBAC/reload certification with real data |
| Client 360 and forms | Profiles, consent, notes, treatment photos, signatures, clinical profile and AI Scribe source workflow exist | Clinical/provider/privacy/device accuracy certification |
| POS, GST and payments | POS, GST, refunds, credit notes, payment links, mandates, disputes, settlements and terminal contracts exist | Merchant KYC/KYB, real credentials, webhooks, PCI/ASV, terminal/Tap to Pay and payout reconciliation |
| Membership, packages and retention | Membership, package, gift card, loyalty, referral, churn and retention foundations exist | Auto-renew/freeze/transfer/liability and provider-backed payment UAT |
| Inventory and procurement | Batches, expiry, FEFO, kits, barcode, procurement, transfers and AI reorder foundation exist | Authenticated workflow, physical print/device and real inventory reconciliation evidence |
| Staff, attendance and payroll | Scheduling, attendance, leave, corrections, commissions, tip payout and India payroll foundation exist | Bank payout, statutory filing/provider certification and regional payroll packs when approved |
| Marketing and communications | WhatsApp/SMS/email, campaigns, consent, segments, lead scoring, attribution, retry/DLQ and inbox source exist | Live numbers/templates, DLT, SPF/DKIM/DMARC, webhooks, delivery/reconciliation and social publishing |
| AI workforce | Eleven governed agent roles, proposal/validation/approval flow and three reversible earned-autonomy actions exist | Broader action-specific evaluation and approved autonomy; money, booking and sensitive messaging remain approval-first |
| Customer and Staff mobile apps | Capacitor wrappers, offline policies, push registration, deep links, GPS, camera and telemetry exist | Signed builds, real-device UAT, APNs/FCM, stores, crash monitoring and forced upgrade proof |
| Hardware and telephony | Generic printer/scanner/camera/kiosk/biometric/terminal contracts plus voice webhooks and call records exist | Named-device certification; PSTN/SIP carrier, numbers, IVR, transfer, queues and delivery certification |
| Accounting and compliance | Journals, GST, liabilities, deferred revenue, cost centres, mappings and reconciliation foundations exist | Live QuickBooks/Xero/Tally, government invoice/e-way-bill, filing data, bank and payout-provider proof |
| Migration | Zenoti/DINGG adapters, resumable/sharded execution and reconciliation foundations exist | Original authenticated exports, historical contracts, measured scale, kill/resume, financial reconciliation, KMS signing and rollback proof |
| SaaS, security and marketplace | Multi-location, subscriptions, customer marketplace, SSO, SCIM, MFA, passkeys and security centre foundations exist | Third-party developer app store/OAuth scopes/billing/certification/sandbox lifecycle |
| Production operations | AWS/Terraform and operational source exists | Deployed AWS, HTTPS, RDS/Redis, secrets, observability, backup/restore/rollback, load/WAF/incident/rotation and noisy-neighbour evidence |

## Genuinely missing or clearly incomplete differentiators

- Full drag-and-drop salon website/CMS builder with templates, pages, SEO and one-click publishing.
- Certified Reserve with Google connector with live availability, modification and cancellation sync.
- Native Facebook/Instagram booking lifecycle and scheduled social publishing/inbox reconciliation.
- Live external review ingestion, reply publishing, escalation and provider reconciliation.
- Full e-Prescribing and specialist medspa EMR workflow.
- Scheduled enterprise S3/Redshift fact-and-dimension warehouse feed with incremental/schema contracts.
- Third-party developer marketplace and certified named partner/device compatibility catalogue.
- Fully managed telephony/contact centre and multi-country statutory payroll.

## Do not rebuild

Do not start parallel implementations for appointment scheduling, recurring/group/couple booking, rooms/resources, waitlist, online booking/webstore, Customer App, Staff App, Client 360, forms/consent/photos, POS/GST/refunds, cash drawer/EOD, memberships/packages/gift cards/loyalty/referrals, inventory/procurement/AI reorder, staff scheduling/attendance/payroll/commissions, lead/retention/campaign foundations, unified communications, SSO/SCIM/MFA/passkeys, governed AI, multi-location SaaS or the customer marketplace. Review and extend the existing source path.

## Implementation order

1. Review high-confidence and schema-only parity candidates and record real UI/API/data/test evidence.
2. Activate payments, communications, push, voice, AI and accounting providers.
3. Implement Reserve with Google, Meta booking and external review sync.
4. Build the website/CMS only after its new-page visual proposal is approved.
5. Add clinical/ePrescription only for an approved medspa target.
6. Add warehouse feeds only for an approved enterprise-chain contract.
7. Complete signed mobile, named hardware and store certification.
8. Complete AWS deployment, restore, load and production certification.
