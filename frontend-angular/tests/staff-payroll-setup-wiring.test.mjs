import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.html', import.meta.url), 'utf8');
const pageComponent = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.ts', import.meta.url), 'utf8');
const component = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-setup.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-setup.component.html', import.meta.url), 'utf8');
const views = readFileSync(new URL('../src/app/features/staff-os/domain/staff-os.models.ts', import.meta.url), 'utf8');
const selfDashboard = readFileSync(new URL('../../backend-rust/src/repositories/staff_enterprise_repository.rs', import.meta.url), 'utf8');
const attendanceRoutes = readFileSync(new URL('../../backend-rust/src/routes/staff_attendance.rs', import.meta.url), 'utf8');
const staffPayroll = readFileSync(new URL('../../staff-app/src/app/features/staff/staff-payroll.page.ts', import.meta.url), 'utf8');

assert.match(page, /<staff-payroll-setup[^>]+\[initialSection\]="setupSection"[^>]+\[createAdjustment\]="setupCreateAdjustment"[^>]+\[initialAdjustmentKind\]="setupAdjustmentKind"/);
assert.match(page, /\(click\)="selectTab\(tab\.key\)"/);
assert.match(pageComponent, /private readonly setupSections: SetupSection\[] = \['structure', 'adjustments', 'incentives', 'statutory', 'revisions', 'advances', 'overtime', 'period', 'notifications'\]/);
assert.match(pageComponent, /if \(this\.isSetupSection\(section\)\) this\.setupSection = section/);
assert.match(pageComponent, /queryParams: \{ tab, \.\.\.\(tab === 'setup' \? \{ section: this\.setupSection \} : \{\}\) \}/);
for (const section of ['structure', 'adjustments', 'incentives', 'statutory', 'revisions', 'advances', 'overtime', 'period', 'notifications']) {
  assert.ok(component.includes(`'${section}'`), `missing ${section} setup section`);
}
for (const endpoint of [
  '/staff/payroll-structure', '/staff/payroll-adjustment-rules', '/staff/incentive-rules',
  '/staff/payroll-compliance/rules', '/staff/salary-revisions', '/staff-advances', '/notification-preferences',
]) assert.ok(component.includes(endpoint), `missing ${endpoint} wiring`);
assert.doesNotMatch(component, /localStorage|sessionStorage/);
assert.match(component, /await this\.loadSection\(section\)/);
assert.match(component, /queryParams: \{ tab: 'setup', section \}/);
assert.match(component, /ensureNotificationStaff\(\)/);
assert.match(component, /this\.notificationStaffId = this\.staff\[0\]\.id/);
assert.match(template, /<as-date-picker/);
assert.match(template, /class="setup-drawer"/);
assert.match(template, /type="number"[^>]*placeholder="Enter amount"/);
assert.match(views, /label: 'Add fine rule'.+kind=fine&create=1/);
assert.match(views, /label: 'Apply staff fine'.+route: '\/staff\/attendance-summary'/);
assert.match(selfDashboard, /payroll_rules: Value/);
assert.match(selfDashboard, /staff_payroll_adjustment_rules pr[\s\S]+pr\.active=TRUE/);
assert.match(attendanceRoutes, /async fn correct_attendance[\s\S]+!is_attendance_manager\(&claims\)/);
assert.match(staffPayroll, /Deductions/);
assert.match(staffPayroll, /item\.deductionsPay/);

console.log('staff payroll setup wiring checks passed');
