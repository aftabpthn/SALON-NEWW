import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repository = readFileSync(new URL('../../backend-rust/src/repositories/staff_payroll_repository.rs', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../backend-rust/src/services/staff_payroll_service.rs', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../backend-rust/src/routes/staff_payroll.rs', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.html', import.meta.url), 'utf8');

assert.match(repository, /PayrollHistoryRunRecord/);
assert.match(repository, /branch_name/);
assert.match(repository, /payment_reference/);
assert.match(service, /history_with_limit\(db, tenant_id, branch_ids, query, 5_000\)/);
assert.match(service, /corrections\.sort_by/);
assert.match(service, /salary_row_i64\(&salary_row, "approvedOvertimeMinutes"\)/);
assert.match(routes, /history_export\(/);
assert.match(routes, /payroll_history_run_context/);
assert.match(routes, /item\.holiday_days_x2/);
assert.match(page, /\/staff-payroll\/history\?/);
assert.match(page, /history\/export\?/);
assert.match(page, /branchId=/);
assert.match(template, /historyValidationState/);
assert.match(template, /changeHistoryPage/);

console.log('staff payroll Phase 7 wiring checks passed');
