import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Phase 6 reports HR truth and keeps alerts idempotent', () => {
  const routes = read('../backend-rust/src/routes/staff_hrms.rs');
  const auth = read('../backend-rust/src/routes/auth.rs');
  const repository = read('../backend-rust/src/repositories/staff_hrms_repository.rs');
  const service = read('../backend-rust/src/services/staff_hrms_service.rs');
  const main = read('../backend-rust/src/main.rs');
  const authService = read('../backend-rust/src/services/auth_service.rs');
  const manager = read('src/app/pages/staff/control-center/staff-control-center-page.component.ts');
  const managerTemplate = read('src/app/pages/staff/control-center/staff-control-center-page.component.html');

  assert.match(routes, /\/staff\/hrms\/operations-intelligence/);
  assert.match(auth, /WHERE tenant_id=\$1::UUID AND active=TRUE ORDER BY/);
  assert.doesNotMatch(auth, /active=TRUE AND \(id::TEXT='branch_hyd'/);
  for (const source of ['staff_documents', 'staff_skill_licenses', 'staff_lifecycle_cases', 'staff_attendance_records', 'staff_payroll_corrections', 'staff_performance_reviews', 'staff_tasks']) {
    assert.match(repository, new RegExp(source));
  }
  assert.match(repository, /metadata_json->>'idempotencyKey'/);
  assert.match(repository, /evidenceCoveragePercent/);
  assert.match(repository, /insufficient_evidence/);
  assert.match(repository, /active_hrms_scopes/);
  assert.match(service, /"transactionalStaffChanges": false/);
  assert.match(service, /"payrollChanges": false/);
  assert.match(service, /run_scheduled_operations_intelligence/);
  assert.match(main, /run_scheduled_operations_intelligence/);
  assert.match(authService, /staff\.hrms\.read/);
  assert.match(authService, /staff\.hrms\.manage/);
  assert.match(manager, /runHrOperationsAutomations/);
  assert.match(manager, /Insufficient evidence/);
  const hrmsWorkflows = manager.slice(manager.indexOf('createJobOpening()'), manager.indexOf('async runHrOperationsAutomations()'));
  assert.match(hrmsWorkflows, /openHrmsEditor/);
  assert.doesNotMatch(hrmsWorkflows, /this\.ask/);
  assert.match(managerTemplate, /class="hrms-drawer"/);
  assert.match(manager, /exportEmployeeLifecycle/);
  assert.match(manager, /exportHrHealth/);
});
