import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const setup = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-setup.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-setup.component.html', import.meta.url), 'utf8');
const payrollPage = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.html', import.meta.url), 'utf8');
const attendanceService = readFileSync(new URL('../../backend-rust/src/services/staff_attendance_service.rs', import.meta.url), 'utf8');
const attendanceRoute = readFileSync(new URL('../../backend-rust/src/routes/staff_attendance.rs', import.meta.url), 'utf8');

for (const endpoint of ['/staff-attendance/overtime', '/staff-payroll/periods', '/staff-payroll/periods/lock', '/reopen']) {
  assert.ok(setup.includes(endpoint), `missing ${endpoint} wiring`);
}
assert.match(setup, /query\.set\('staffId'/);
assert.match(template, /Overtime Approvals/);
assert.match(template, /Payroll Period Controls/);
assert.match(template, /Approved minutes/);
assert.match(template, /Attendance correction deadline/);
assert.match(payrollPage, /regenerateAfter\?\.validationWarnings/);
assert.match(attendanceService, /ensure_attendance_editable\(db, tenant_id, branch_id, business_date\)\.await\?/);
assert.match(attendanceRoute, /denied_permissions/);
assert.match(attendanceRoute, /staff\.payroll\.manage/);

console.log('staff payroll Phase 5 wiring checks passed');
