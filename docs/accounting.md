# Accounting and Balance Sheet

## Scope

AuraShine uses the Rust/Axum backend and PostgreSQL journal tables as the accounting source of truth. The `/finance` Angular page presents an as-of-date Balance Sheet and focused finance controls. It does not introduce a standalone Profit and Loss report, Trial Balance, Cash Flow, forecast, or finance dashboard.

## Journal foundation

- Durable entries use `accounting_journal_entries` and `accounting_journal_lines`.
- Every entry is tenant and branch scoped.
- `business_date` is the reporting date used by historical Balance Sheet and ledger queries.
- Journal writes require balanced debit and credit totals in integer paise.
- Automatic operational postings and manual journals use source/idempotency keys to prevent duplicates.
- Locked accounting periods reject back-dated finance writes until an authorized reopen.

## Micro P&L contract

Micro P&L is an analytical projection inside the existing Reports surface, not a
second accounting ledger or a standalone P&L page. PostgreSQL journals remain the
official financial truth.

- Grain: one POS sale line, with refund, deferred-revenue, inventory-cost, and
  commission events linked by their real source identifiers.
- Recognized revenue: immediate taxable revenue for service/product lines,
  deferred-revenue recognition for membership/package lines, less the net-of-tax
  value of recorded refund lines. Tax and tips are not operating revenue.
- Phase 1 profit level: `contributionProfitPaise = recognizedRevenuePaise -
  productCostPaise - staffCostPaise`.
- `staffCostPaise` is recorded commission only in Phase 1. Salary/time cost and
  allocated overhead are later profit levels and must not be labelled net profit.
- Missing invoice journals, required inventory costs, or required commission
  snapshots mark a line incomplete. Incomplete lines must not be presented as a
  production-ready profit answer.
- Reconciliation compares Micro P&L revenue and product cost to journal revenue
  and COGS for the same authorized branches and business-date range.
- Corrections use existing refund, return, and journal reversal events; Micro P&L
  does not copy or mutate the source ledgers.

Phase 1 APIs:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/profit-intelligence/micro-lines` | Paginated sale-line contribution facts and completeness status |
| `GET` | `/profit-intelligence/reconciliation` | Ledger variance and missing-source diagnostics |

### Phase 2 cost levels

- Contribution profit subtracts inventory cost and immutable POS commission
  snapshots from recognized revenue.
- Controllable profit additionally subtracts staff-time cost and recorded
  gateway/refund fees. Staff-time cost uses finalized or paid payroll salary
  plus overtime divided by attendance-derived worked minutes; payroll commission
  is excluded because the POS commission snapshot is already counted.
- Package and membership redemptions recognize the exact immutable value carried
  by their credit/redemption ledgers. The last redemption receives any integer
  paise remainder.
- Fully-loaded profit additionally subtracts journal-backed overhead. Allocation
  rules are append-only versions using `service_minutes`,
  `chair_resource_minutes`, `revenue_share`, `headcount`, or
  `transaction_count`; rule account codes select the real journal expense pool.
- Missing finalized payroll, gateway reconciliation/refund fee evidence, or an
  applicable overhead rule keeps the fully-loaded line incomplete.

Phase 2 rule APIs:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/profit-intelligence/allocation-rules` | List authorized branch rule versions |
| `POST` | `/profit-intelligence/allocation-rules` | Create the next effective rule version |

### Phase 3 reconciliation and close readiness

- Every sale line exposes cost completeness in basis points. Required product,
  commission, staff-time, gateway/refund-fee, and overhead evidence must be
  recorded; not-applicable components count as complete.
- The revenue bridge explains ledger revenue plus missing invoice journals
  against Micro revenue and leaves any remaining difference as unexplained.
- COGS compares journal `COST_OF_GOODS_SOLD` with inventory-ledger cost. Payroll
  compares journal `PAYROLL_EXPENSE` with finalized/paid payroll-run gross value.
- Missing invoice journals are a live derived queue, not duplicated business
  state. Repair uses the idempotent invoice journal writer, original business
  date, actor identity, and refuses closed accounting periods.
- Finance hardening and period close are blocked while Micro revenue, COGS,
  payroll, or cost completeness is unresolved.
- Profit leaks, pricing actions, and copilot recommendations are suppressed for
  any period containing incomplete cost rows.

Phase 3 APIs:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/profit-intelligence/reconciliation/invoice-repair-queue` | List missing invoice journals for the authorized scope and period |
| `POST` | `/profit-intelligence/reconciliation/invoice-repair-queue` | Idempotently repair open-period invoice journals |

### Phase 4 Reports workspace

- Micro P&L stays inside the existing Reports workspace. The overview and service,
  staff, customer, product, appointment, branch, and channel dimensions use the
  same Micro profit event and cost engine.
- Contribution and fully-loaded selectors change the displayed cost, profit, and
  margin without relabelling contribution as accounting net profit.
- Previous-period comparison uses an immediately preceding range of equal length.
- Dimension rows drill into real sale-line lineage: invoice, appointment, invoice
  journal, inventory movement, cost completeness, and contribution/fully-loaded
  profit identifiers.
- Reconciliation badges remain visible across the workspace. Governance Rules,
  Approvals, and Audit reuse the existing profit-governance APIs and permissions.
- CSV and Excel-compatible exports are generated from the selected real dimension.
  Saved views reuse durable custom-report definitions and restore scope, dates,
  tab, and profit level.

### Phase 5 automated action queue

- A leased PostgreSQL worker scans each active branch every 15 minutes and uses
  the current month-to-date Micro P&L period. Multiple backend instances claim
  branches with `SKIP LOCKED`; failed scans retry after five minutes.
- Only cost-complete advanced insights can create actions. Low-margin, discount,
  recipe-variance, and pricing signals reuse the existing profit-governance
  evaluation and approval trail.
- The deterministic action key is derived from source, period, and rule. Repeated
  observations update the same action and realized impact; a new period creates
  the next occurrence under the same recurrence key.
- Every queue row records a real active owner, due time, priority-based SLA,
  notes, structured evidence, baseline, expected impact, realized impact, and
  the latest observation time. Completion can add audited notes, evidence, and
  a realized-impact override.
- The existing Reports Action Queue shows automated occurrences, period, owner,
  SLA/overdue state, and all three impact values. No standalone P&L route is added.

## Balance Sheet API

All routes are under `/api/v1` and require authenticated tenant and branch context.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/balance-sheet/accounts` | Account definitions and grouping |
| `GET` | `/balance-sheet/live?asOfDate=YYYY-MM-DD&scope=branch|tenant` | Assets, liabilities, equity, and equation variance for the selected branch or authorized tenant branches |
| `GET` | `/balance-sheet/working-capital?asOfDate=YYYY-MM-DD&scope=branch|tenant` | Current assets, current liabilities, and working capital for the selected branch or authorized tenant branches |
| `GET` | `/balance-sheet/ledger` | Paginated account ledger with running balance and cost centre |
| `POST` | `/balance-sheet/journals` | Balanced manual journal |
| `GET/POST` | `/balance-sheet/cost-centers` | Cost centre list and creation |
| `PUT` | `/balance-sheet/journal-lines/:line_id/cost-center` | Assign a ledger line to a cost centre |
| `GET/POST` | `/balance-sheet/fixed-assets` | Fixed-asset register and purchase posting |
| `POST` | `/balance-sheet/fixed-assets/:asset_id/depreciation` | Monthly depreciation posting |
| `GET` | `/balance-sheet/deferred-revenue` | Membership/package deferred-revenue schedules |
| `POST` | `/balance-sheet/deferred-revenue/:schedule_id/recognize` | Revenue recognition posting |
| `GET` | `/balance-sheet/periods` | Accounting period history |
| `POST` | `/balance-sheet/periods/close` | Close a period with reason and audit identity |
| `POST` | `/balance-sheet/periods/:period/reopen` | Reopen a closed period with reason |
| `GET` | `/balance-sheet/reconciliation` | Source-to-ledger reconciliation checks |
| `GET` | `/balance-sheet/hardening-status` | Period, equation, warning, and critical status |
| `POST` | `/balance-sheet/snapshots` | Archive the selected as-of-date report |

## Frontend behavior

The `/finance` route loads real API values only and uses the shared `DD/MM/YYYY` date picker while sending ISO dates to the backend. It provides:

- approved 192 by 82 pixel KPI cards for assets, liabilities, equity, working capital, and variance;
- account rows that open the filtered ledger;
- manual balanced journals;
- cost centre creation and ledger-line tagging;
- fixed-asset creation and depreciation;
- deferred-revenue recognition;
- period close and reopen controls;
- reconciliation/hardening status and snapshot archival;
- current-versus-prior comparison for the selected branch or all authorized branches, with branch count, CSV evidence export, and print/PDF output;
- compact loading, error, success, permission, and empty states.

After every write, the page reloads the affected list and the Balance Sheet/hardening data where balances can change. The selected as-of date, active tab, ledger filters, and page state remain intact.

## Access control

Read access is available to finance/report readers accepted by the backend policy, including the owner, admin, manager, analyst, and accountant roles or an accepted read permission. Tenant-scope consolidation is limited to owner, admin, manager, and analyst roles and aggregates only branches returned by the authenticated user's branch-access policy. Write controls are shown only to owner, admin, manager, accountant, or a user granted `finance.write`; the backend remains authoritative for every request.

## Verification

Backend compile verification is run from `backend-rust` with `cargo check`. Frontend type verification can run the Angular compiler directly. Per repository policy, an AI agent must not execute npm scripts; a human can run the production build with:

```powershell
cd frontend-angular
npm run build
```
