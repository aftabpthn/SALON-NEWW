# Advanced Staff OS

All Staff OS capabilities are delivered by **extending the nine existing staff
router modules**. There is no parallel staff module, no second payroll surface,
and no separate mobile API — the Staff App reuses `/staff/self/*`,
`/staff/mobile/*`, and `/staff-self/*`.

The machine-checked map lives in
`backend-rust/src/services/staff_os_registry.rs`; this document is its
human-readable view. Both are kept in sync by tests.

## Owning modules

| Module | Scope |
| --- | --- |
| `routes::staff` | Staff master, documents, files, logins, branch access, masters |
| `routes::staff_advance` | Salary advance ledger |
| `routes::staff_advanced` | Targets/incentives, fines/deductions, payroll structure, tasks, performance, biometric, mobile surfaces |
| `routes::staff_attendance` | Attendance, breaks, overtime approval, corrections |
| `routes::staff_enterprise` | Salary revisions, tips, roster, manpower, replacement, notifications, coach, audit, statutory rules |
| `routes::staff_leave` | Leave requests, balances, approvals |
| `routes::staff_operations` | Shift templates/schedules, shift swaps, branch transfers, skill licences, performance reviews |
| `routes::staff_payroll` | Payroll lifecycle, commissions, payslips, history, corrections, periods, statutory profiles |
| `routes::staff_schedule` | Schedule grid and copy |

## Capability map

| # | Capability | Owner module | Representative routes | Staff App |
| --- | --- | --- | --- | --- |
| 1 | Staff master and documents | `staff` | `/staff`, `/staff/masters`, `/staff/:id/documents`, `/staff/:id/files` | — |
| 2 | Skills and service assignments | `staff_operations` | `/staff/skill-licenses`, `/staff/:id/configuration`, `/staff-enterprise/skill-matrix` | — |
| 3 | Shift templates and schedules | `staff_schedule` | `/staff-schedule`, `/staff-schedule/copy`, `/staff/operations/templates`, `/staff/operations/schedules` | ✓ |
| 4 | Shift swaps | `staff_operations` | `/staff/shift-swaps`, `/staff/shift-swaps/:id/decision` | ✓ |
| 5 | Attendance and overtime approval | `staff_attendance` | `/staff-attendance/summary`, `/clock-in`, `/clock-out`, `/overtime/:id/decision`, `/:staff_id/:date/correction` | ✓ |
| 6 | Leave policies, balances and approvals | `staff_leave` | `/staff-leave/requests`, `/balances`, `/requests/:id/approve`, `/reject` | ✓ |
| 7 | Branch transfers | `staff_operations` | `/staff/branch-transfers`, `/staff/branch-transfers/:id/decision` | — |
| 8 | Salary structures and revisions | `staff_enterprise` | `/staff/payroll-structure`, `/staff/salary-revisions`, `/staff/salary-revisions/:id/decision` | — |
| 9 | Salary advance ledger | `staff_advance` | `/staff-advances`, `/:id/decision`, `/:id/disburse`, `/:id/waive`, `/:id/recoveries` | — |
| 10 | Payroll calculation/review/finalization/payment | `staff_payroll` | `/staff-payroll/preview`, `/runs`, `/runs/:id/review`, `/finalize`, `/mark-paid`, `/payout`, `/periods/lock` | — |
| 11 | Commission and tips | `staff_payroll` | `/staff-payroll/commissions/calculate`, `/staff/tips`, `/staff/tips/payouts` | — |
| 12 | Targets and incentives | `staff_advanced` | `/staff/incentive-rules`, `/staff/self/targets`, `/staff/mobile/targets` | ✓ |
| 13 | Authorized fines/deductions | `staff_advanced` | `/staff/payroll-adjustment-rules` | — |
| 14 | Performance history | `staff_advanced` | `/staff/performance`, `/staff/performance/:staff_id`, `/staff/:id/hr-history` | ✓ |
| 15 | Manager feedback | `staff_operations` | `/staff/performance-reviews` | — |
| 16 | Tasks and learning | `staff_advanced` | `/staff/tasks`, `/staff/tasks/:id/comments`, `/staff/self/tasks/:id/status`, `/staff-enterprise/training` | ✓ |
| 17 | Replacement recommendations | `staff_enterprise` | `/staff/replacement/recommend`, `/:id/decision`, `/history`, `/staff/intelligence/replacement-suggestion` | — |
| 18 | Roster optimization | `staff_enterprise` | `/staff/roster/optimize`, `/coverage`, `/gaps`, `/drafts/:id/apply` | — |
| 19 | Manpower forecasting | `staff_enterprise` | `/staff/manpower/forecast`, `/recalculate`, `/hiring-recommendations` | — |
| 20 | Staff notifications | `staff_enterprise` | `/staff/notifications`, `/notification-templates`, `/notification-delivery-logs` | ✓ |
| 21 | Payslip and payroll history | `staff_payroll` | `/staff-payroll/history`, `/runs/:id/payslips/:staff_id`, `/staff/self/payslips/:run_id`, `/staff/mobile/payroll` | ✓ |
| 22 | Audit and correction/reversal | `staff_payroll` | `/staff/audit`, `/staff-payroll/runs/:id/corrections`, `/corrections/:id/decision`, `/post`, `/cancel` | — |

## Enforced invariants

`staff_os_registry`'s tests fail the build when any of these break:

1. **Every capability route is permission-mapped.** A route that falls through
   `middleware::tenant::route_access` hits the default deny and 403s for every
   caller. This test found that the entire `/staff-advances` ledger was
   unmapped and unreachable in production.
2. **Capabilities extend existing modules only.** `owner_module` must be one of
   the nine modules in `STAFF_MODULES`; a new name means a parallel staff
   surface was started and needs review.
3. **No two capabilities claim the same route** — overlapping ownership is how
   duplicate surfaces creep in.
4. **All 22 capabilities stay registered**, each with routes.
5. **Staff App capabilities reuse existing self-service surfaces**
   (`/staff/self`, `/staff/mobile`, `/staff-self`, or a self-scoped
   operational route) instead of a separate mobile API.

## Adding a capability

1. Find the module whose domain already covers it and extend that router — do
   not create a new staff module.
2. Ensure the new route is permission-mapped in `middleware::tenant` and its
   permissions are in `services::permission_registry` (see
   `docs/PERMISSION_ENGINE.md`).
3. Register the capability (or add routes to an existing entry) in
   `staff_os_registry`.
4. Run `cargo test staff_os_registry`.

Related: `docs/PERMISSION_ENGINE.md` (permissions, staff identity scoping,
entitlements) and `docs/PAYROLL_COMPLIANCE.md` (payroll authority and
statutory configuration).
