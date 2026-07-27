import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repository = readFileSync(new URL('../../backend-rust/src/repositories/staff_payroll_repository.rs', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../backend-rust/src/routes/staff_payroll.rs', import.meta.url), 'utf8');
const payroll = readFileSync(new URL('../../backend-rust/src/services/staff_payroll_service.rs', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.html', import.meta.url), 'utf8');

assert.match(repository, /AND \(\$5<>'approved' OR requested_by<>\$6\)/);
assert.match(routes, /payroll\.correction_approve/);
assert.match(routes, /corrected: Option<bool>/);
assert.match(payroll, /include_corrections: bool/);
assert.match(payroll, /"CORRECTED STAFF PAYSLIP"/);
for (const action of ['requestCorrection', 'decideCorrection', 'cancelCorrection', 'postCorrection', 'printCorrectedPayslip']) {
  assert.match(page, new RegExp(`async ${action}\\(`));
}
assert.match(template, /A different payroll manager must approve this request/);
assert.match(template, /Audit history/);

console.log('staff payroll Phase 9 wiring checks passed');
