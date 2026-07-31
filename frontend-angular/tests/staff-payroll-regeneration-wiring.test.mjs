import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(
  new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.ts', import.meta.url),
  'utf8',
);
const template = readFileSync(
  new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.html', import.meta.url),
  'utf8',
);

assert.match(component, /existingPeriodRun/);
assert.match(component, /existingPeriodItems/);
assert.match(component, /fetchRunDetail\(existing\.id\)/);
assert.match(component, /\['calculated', 'reviewed'\]\.includes\(this\.existingPeriodRun!\.status\)/);
assert.match(component, /\['finalized', 'partially_paid', 'paid'\]\.includes\(this\.existingPeriodRun\.status\)/);
assert.match(component, /this\.regenerateBefore = this\.existingPeriodItems\.find/);
assert.match(template, /\{\{ primaryActionLabel \}\}/);
assert.match(template, /class="detail-drawer regeneration-drawer"/);
assert.match(template, /<footer class="regenerate-actions">/);
assert.equal((template.match(/Regenerate selected staff/g) || []).length, 0);

console.log('staff payroll regeneration wiring checks passed');
