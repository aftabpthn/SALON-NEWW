import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('attendance summary reuses Rust payroll preview for salary fields', () => {
  const component = read('../src/app/pages/staff/attendance-summary/staff-attendance-summary-page.component.ts');
  const template = read('../src/app/pages/staff/attendance-summary/staff-attendance-summary-page.component.html');
  const styles = read('../src/app/pages/staff/attendance-summary/staff-attendance-summary-page.component.css');

  assert.match(component, /\/staff-payroll\/preview\?\$\{this\.query\(\)\}/);
  assert.match(component, /salaryRows \|\| \[\]\)\.map/);
  assert.match(component, /validationErrorCount/);
  assert.match(component, /payrollMoney\(row: AttendanceSummaryRow, key: string\)/);
  assert.match(component, /this\.router\.navigate\(\['\/staff\/payroll'\]/);

  assert.match(template, /Generate salary/);
  assert.match(template, /payrollMoney\(row, 'earnedSalaryPaise'\)/);
  assert.match(template, /payrollMoney\(row, 'advanceRecoveryPaise'\)/);
  assert.match(template, /payrollStatus\(row\)/);
  assert.match(styles, /\.payroll-state/);
});
