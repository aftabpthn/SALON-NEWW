import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../backend-rust/migrations/0267_staff_notification_idempotency.sql', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../../backend-rust/src/repositories/staff_enterprise_repository.rs', import.meta.url), 'utf8');
const enterprise = readFileSync(new URL('../../backend-rust/src/services/staff_enterprise_service.rs', import.meta.url), 'utf8');
const payroll = readFileSync(new URL('../../backend-rust/src/services/staff_payroll_service.rs', import.meta.url), 'utf8');
const controlCenter = readFileSync(new URL('../src/app/pages/staff/control-center/staff-control-center-page.component.ts', import.meta.url), 'utf8');

assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_notification_queue_idempotency/);
assert.match(repository, /pub language_code: String/);
assert.match(repository, /ORDER BY CASE WHEN language_code=\$4 THEN 0 ELSE 1 END LIMIT 1/);
assert.match(enterprise, /quiet_delay\(local_time, start, end\)/);
assert.match(enterprise, /record_notification_delivery/);
assert.match(payroll, /contains_payroll_amounts && amount_consent/);
assert.match(payroll, /variables\.retain\(\|key, _\| !is_payroll_amount_variable\(key\)\)/);
assert.match(payroll, /queue_posted_correction_notification/);
assert.match(payroll, /payroll_corrected:posted:/);
for (const type of ['payroll_finalized', 'payroll_paid', 'payroll_payslip_available', 'payroll_fine_applied', 'payroll_advance_recovered', 'payroll_corrected']) {
  assert.match(controlCenter, new RegExp(type));
}

console.log('staff payroll Phase 8 wiring checks passed');
