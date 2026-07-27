# Payroll And Legal Compliance

The Rust backend is the only payroll calculation authority. No client, script,
or external service computes wages; the frontend only renders backend results.

## Calculation guarantees

| Guarantee | Where it is enforced |
| --- | --- |
| Integer paise everywhere | All amounts are `_paise BIGINT`; no floats in wage math |
| Effective-dated salary structures | `staff_salary_revisions` with effective dates; runs read the structure effective for the period |
| Approved attendance and overtime | Overtime pays only from `ot_approval_status='approved'` / `approved_overtime_minutes` (migration 0257); attendance is content-hashed (`attendance_source_hash`) so post-calculation source changes surface as warnings |
| Approved salary advances | `staff_salary_advances` (0256); recovery is scheduled oldest-first, capped so net pay never goes below zero; the ledger moves only on finalization |
| Statutory deductions | Configured rules only — see below; missing profile/identifiers (UAN, ESIC number, PAN, PT state) fail validation instead of silently defaulting |
| Finalized payroll immutable | `finalized`/`paid` runs refuse recalculation; period locks (`staff_payroll_periods`, 0257) gate the month |
| Correction through reversal/revision | `staff_payroll_corrections` (0259) — separate, approved adjustment entries; the original payslip stays unchanged |
| Accounting posting idempotent | Payroll postings carry idempotency keys in `accounting_service` |
| Payslip snapshot reproducible | Payslips render only after finalization from the stored `calculation_json` snapshot, stamped with `payslip_version_hash` (run + item + amounts + attendance hash + corrections) |

## Statutory rules are configuration, never code

No statutory rate, ceiling, slab, or section number is hardcoded in source.
`staff_payroll_statutory_rules` stores, per rule:

- **Jurisdiction**: `state_code` (empty = central/default), resolved per staff
  member's PT state.
- **Rule type**: `provident_fund`, `esic`, `professional_tax`, `tds`,
  `gratuity`, `bonus`.
- **Employee/employer rate**: `employeeBasisPoints` / `employerBasisPoints`
  (or fixed paise amounts, or `employeeSlabs` — bracket tables with
  `upToPaise` + `amountPaise`/`basisPoints`, used for PT slabs and
  slab-configured TDS).
- **Wage ceiling**: `wageCapPaise` (rate base cap) and `eligibilityCapPaise`
  (rule applies only up to this gross).
- **Effective-from/effective-to**: date-ranged rows; the engine picks the row
  effective for the payroll period, so rate transitions (e.g. the April 2026
  salary TDS changes) are new dated rows, not code edits.
- **Rounding method**: `floor`, `nearest_paisa`, `ceiling_paisa`,
  `floor_rupee`, `nearest_rupee` (EPFO-style), `ceiling_rupee`.
- **Applicability conditions**: `applicability_json`
  (`minMonthlyGrossPaise`, `maxMonthlyGrossPaise`, `notes`).
- **Official reference**: mandatory citation of the notification, circular,
  or section the configuration implements.
- **Approved-by / approved-at**: the CA/labour professional who approved the
  configuration, recorded at creation. Rule creation is refused without a
  reference and approver.

## Records and retention

- Attendance/muster, wage registers, overtime approvals, fines/deductions,
  and wage slips are all first-class, tenant-scoped records with audit
  events, matching Ministry of Labour guidance on electronic records and
  wage slips (see the [Ministry compliance handbook](https://www.labour.gov.in/static/uploads/2026/02/83978455025732b99b0165def80ab171.pdf)
  and the [Labour Codes portal](https://www.labour.gov.in/offerings/schemes-and-services/details/labour-codes-gzNzQzMtQWa)).
- Core employee wage records are **never destroyed** by subscription
  lifecycle events — cancellation/expiry only gates access (see
  `docs/PERMISSION_ENGINE.md`), preserving the five-year retention
  expectation regardless of billing state.
- Salary TDS behaviour follows configured, effective-dated rules; consult the
  [Income Tax Department TDS guidance](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance)
  when entering new rows.

## Disclaimer

This document describes architecture, not legal advice. State labour, PT,
LWF, EPF, ESI, and income-tax applicability differ by state and change over
time; every statutory rule row must be reviewed and approved by a CA or
labour professional before it takes effect — which is why the engine refuses
rules without an official reference and approver.
