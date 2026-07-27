import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const payrollService = readFileSync(new URL('../../backend-rust/src/services/staff_payroll_service.rs', import.meta.url), 'utf8');
const advancedService = readFileSync(new URL('../../backend-rust/src/services/staff_advanced_service.rs', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-setup.component.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.html', import.meta.url), 'utf8');

assert.match(payrollService, /period_start - Duration::days\(1\)/);
assert.match(payrollService, /period_end \+ Duration::days\(1\)/);
assert.match(payrollService, /unpaid_week_off_occurrences\(/);
assert.match(payrollService, /attendance_source_hash: attendance_source_hash\(attendance_context_rows\)/);
assert.doesNotMatch(payrollService, /i64::from\(unpaid_leave_days_x2 \/ 2\),\s*&weekend_sandwich/);
assert.match(payrollService, /"weekendSandwichBreakdown"/);
assert.match(payrollService, /month_boundary_uses_adjacent_attendance_context/);
assert.match(advancedService, /weekly-off-worked rules must be allowances/);
assert.match(setup, /adjustmentTriggerChanged/);
assert.match(page, /weekendRuleEvents/);
assert.match(page, /weekendAdjustmentRows/);
assert.match(template, /Weekly-off calculation/);

console.log('staff payroll Phase 6 wiring checks passed');
