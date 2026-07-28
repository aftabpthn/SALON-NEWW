import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../backend-rust/migrations/0269_staff_payroll_partial_payouts.sql', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../../backend-rust/src/repositories/staff_payroll_repository.rs', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../backend-rust/src/routes/staff_payroll.rs', import.meta.url), 'utf8');
const payroll = readFileSync(new URL('../../backend-rust/src/services/staff_payroll_service.rs', import.meta.url), 'utf8');
const accounting = readFileSync(new URL('../../backend-rust/src/services/accounting_service.rs', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/pages/staff/payroll/staff-payroll-page.component.html', import.meta.url), 'utf8');

assert.match(migration, /staff_payroll_payout_states/);
assert.match(migration, /staff_payroll_payout_attempts/);
assert.match(migration, /partially_paid/);
assert.match(repository, /reserve_payout_attempt/);
assert.match(repository, /reconcile_payout_run/);
assert.match(routes, /payouts\/hold/);
assert.match(routes, /payouts\/release/);
assert.match(payroll, /fail_staff_payout/);
assert.match(payroll, /payout_staff_key/);
assert.match(accounting, /post_staff_payroll_payout/);
for (const action of ['openPayouts', 'paySelectedStaff', 'holdSelectedPayouts', 'releaseSelectedPayouts']) {
  assert.match(page, new RegExp(`async ${action}\\(`));
}
assert.match(template, /Staff payouts/);
assert.match(template, /Pay \/ retry selected/);

console.log('staff payroll Phase 10 wiring checks passed');
