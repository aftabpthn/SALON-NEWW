import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Phase 6 reports HR truth and keeps alerts idempotent', () => {
  const routes = read('../backend-rust/src/routes/staff_hrms.rs');
  const repository = read('../backend-rust/src/repositories/staff_hrms_repository.rs');
  const service = read('../backend-rust/src/services/staff_hrms_service.rs');
  const manager = read('src/app/pages/staff/control-center/staff-control-center-page.component.ts');

  assert.match(routes, /\/staff\/hrms\/operations-intelligence/);
  for (const source of ['staff_documents', 'staff_skill_licenses', 'staff_lifecycle_cases', 'staff_attendance_records', 'staff_payroll_corrections', 'staff_performance_reviews', 'staff_tasks']) {
    assert.match(repository, new RegExp(source));
  }
  assert.match(repository, /metadata_json->>'idempotencyKey'/);
  assert.match(service, /"transactionalStaffChanges": false/);
  assert.match(service, /"payrollChanges": false/);
  assert.match(manager, /runHrOperationsAutomations/);
  assert.match(manager, /exportEmployeeLifecycle/);
  assert.match(manager, /exportHrHealth/);
});
