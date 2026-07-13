# AuraShine 100X Enterprise Blueprint

This document defines what "100X advanced" means for AuraShine without changing
the locked stack: Angular, Express ESM, SQLite through `better-sqlite3`, JWT,
RBAC, tenant isolation, integer paise, and add-only evolution.

## 1. 100X Definition

100X is not a rewrite. It is a measurable maturity model:

- Faster decisions: owners see bookings, revenue, cash, stock, staff, and risk
  in one operating view.
- Safer execution: every protected action is permissioned, audited, reversible
  where possible, and tenant-scoped.
- Smarter workflows: AI suggests actions, but deterministic business rules stay
  the source of truth.
- Stronger scale: every module works for single-branch salons and enterprise
  multi-branch tenants.
- Cleaner delivery: each feature ships through existing routes, services,
  repositories, docs, and lean verification.

## 2. Non-Negotiable Architecture

- Frontend: Angular standalone pages and existing app shell.
- Backend: Express JavaScript ESM.
- Database: SQLite, WAL mode, named parameters only.
- Money: integer paise.
- Dates: ISO timestamps, IST business dates.
- Tenancy: `tenantId` and `branchId` on tenant-owned data.
- API: `/api/v1` as stable contract, `/api` compatibility where present.
- Pattern: route -> validator/middleware -> service -> repository.
- Protected files stay protected: wrap or extend around them.

## 3. Executive Command Center

The owner view should answer these questions without exports:

| Area | Question | Source of truth |
| --- | --- | --- |
| Revenue | How much money came in today? | invoices, payments, cash drawer |
| Booking | What capacity is unused? | appointments, staff shifts, slots |
| Clients | Who is likely to churn? | visits, spend, no-shows, campaigns |
| Staff | Who is overloaded or underperforming? | attendance, bookings, sales |
| Inventory | What will run out or expire? | stock movements, batches, recipes |
| Finance | Is the day closed cleanly? | journal lines, settlements, expenses |
| Risk | What needs owner approval? | audit logs, exceptions, approval queues |

## 4. Core Operating Loops

### Booking Loop

Lead -> client lookup -> service selection -> staff/slot recommendation ->
appointment hold -> reminder -> check-in -> completion -> invoice -> review.

Acceptance:

- No double booking.
- Branch and staff access enforced.
- Reminder and no-show states recorded.
- Public booking never bypasses protected service rules.

### POS Loop

Appointment/cart -> service/product items -> discount guard -> tax -> payment ->
invoice -> stock deduction -> journal lines -> receipt -> settlement.

Acceptance:

- Every rupee stored as paise.
- Payment replay cannot double collect.
- Stock deduction is ledger-backed.
- Invoice status derives from payment truth.

### Inventory Loop

Purchase -> batch -> stock in -> transfer/consume/sell -> adjustment -> reorder
signal -> valuation -> audit.

Acceptance:

- Every movement has reason, reference, tenant, branch, and actor.
- WMA costing remains consistent.
- Low-stock and expiry signals are branch-aware.

### Finance Loop

Sale/payment/expense/refund/payroll -> journal entry -> reconciliation -> daily
close -> month close -> owner report.

Acceptance:

- Debit equals credit.
- `journalEntryLines` is the finance source of truth.
- Close jobs are idempotent by tenant, branch, and date.

## 5. Enterprise Modules

| Level | Module | 100X capability |
| --- | --- | --- |
| L1 | CRM | Customer 360, timeline, consent, segmentation |
| L1 | Booking | Smart slots, no-show control, waitlist, reminders |
| L1 | POS | Split payments, refunds, discounts, settlement |
| L1 | Inventory | Batch, transfer, WMA, recipe consumption |
| L1 | Staff | Shifts, attendance, commission, workload |
| L2 | Accounting | Ledger, balance sheet, accruals, daily close |
| L2 | Marketing | WhatsApp/SMS/email journeys and campaign ROI |
| L2 | Reports | Branch, tax, staff, service, inventory, retention |
| L2 | Online Booking | Public profile, policies, approvals, reviews |
| L3 | AI | Next-best-action, risk, forecasting, draft generation |
| L3 | SaaS Admin | Tenant lifecycle, domains, plans, audit, support |
| L3 | Compliance | RBAC, audit everything, incident and backup runbooks |

## 6. AI Operating System

AI is an assistant, not the system of record.

Allowed:

- Draft follow-up messages.
- Explain reports.
- Suggest upsells and retention actions.
- Flag risk: churn, no-show, low stock, margin leak, overdue close.
- Summarize customer timelines.

Not allowed:

- Change money, ledger, stock, booking, or permission state without explicit
  user action and server-side validation.
- Bypass RBAC.
- Invent data not present in tenant scope.
- Store provider prompts containing secrets.

## 7. Security Maturity Gates

| Gate | Requirement |
| --- | --- |
| S1 | JWT, refresh rotation, RBAC, tenant and branch scope |
| S2 | Audit logs for protected actions |
| S3 | Webhook signatures and idempotency |
| S4 | Export/file download permission and audit |
| S5 | Incident response and restore-tested backups |
| S6 | Secrets rotation and encrypted tenant credentials |
| S7 | Tenant isolation regression checks for critical flows |

No feature reaches enterprise status until it clears S1-S3. Finance, exports,
permissions, payments, and customer PII must clear S1-S7.

## 8. Performance Maturity Gates

- Lists are paginated.
- Heavy reports use snapshots.
- Long jobs run outside request paths.
- Frequent filters have `(tenantId, branchId, field)` indexes.
- No query-per-row loops in hot paths.
- Transactions are short and write-only where possible.
- Realtime events broadcast after commit, never before.

## 9. Data Maturity Gates

- Every tenant-owned table includes `tenantId` and `branchId`.
- Business identifiers are unique inside tenant/branch scope.
- Ledger/event rows are append-only where truth matters.
- Corrections use reversal rows or explicit adjustment rows.
- Migrations are additive, idempotent, and documented.
- Restore checks verify row counts and financial totals.

## 10. UX Maturity Gates

- Front desk tasks are reachable in two clicks from the operating shell.
- Every destructive/protected action has clear confirmation and permission.
- Forms show validation near the field.
- Empty/loading/error states are handled.
- Mobile layout does not hide critical controls.
- Dashboards show action, not decoration.

## 11. Integration Maturity Gates

| Integration | Must have |
| --- | --- |
| Razorpay/payments | signature verify, amount paise match, replay guard |
| WhatsApp | template state, delivery status, opt-out, audit |
| SMS/email | provider result, retry state, consent |
| Public booking | tenant profile resolution, branch policies, no auth leak |
| File/export | permission, scan/validation, audit trail |
| AI provider | local fallback, timeout, tenant-scoped context |

## 12. Release Gates

Every enterprise release must provide:

- Scope list.
- Changed files.
- Migration list, if any.
- Rollback note.
- Lean test evidence.
- Known limitations.
- Owner-facing impact summary.
- Git commit and push to `origin`.

## 13. 100X Roadmap

### Phase A: Control Tower

- Executive command center.
- Owner approvals.
- Daily close health.
- Exception queue.
- Branch comparison.

### Phase B: Operational Intelligence

- Booking risk.
- No-show forecast.
- Staff utilization.
- Low-stock forecast.
- Margin-safe discount guard.

### Phase C: Financial Command

- Daily close automation.
- Expense and settlement reconciliation.
- Balance sheet drill-down.
- GST readiness.
- Month-close checklist.

### Phase D: Customer Growth Engine

- Customer 360.
- Segments.
- Win-back campaigns.
- Membership/package optimization.
- Review and referral loop.

### Phase E: Enterprise SaaS

- Tenant onboarding.
- Domain mapping.
- Plan limits.
- Super-admin support console.
- Compliance exports.

## 14. Implementation Rule

For every 100X feature:

1. Find existing route/page/service/repository.
2. Extend additively.
3. Keep protected files untouched.
4. Add tenant/branch scope.
5. Add RBAC/audit where needed.
6. Run the smallest check that proves the change.
7. Update the matching doc.

## 15. Acceptance Criteria

AuraShine is 100X enterprise-ready when:

- Core salon workflows run without manual database edits.
- Owner can reconcile day close from the app.
- Tenant isolation is enforced on critical reads/writes.
- Payments, stock, ledger, and invoices agree.
- AI improves speed but never becomes hidden business truth.
- Backups and restore runbooks are tested.
- Docs tell an engineer exactly where to make the next safe change.
