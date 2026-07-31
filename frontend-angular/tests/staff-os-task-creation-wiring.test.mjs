import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('staff task page creates invoice-linked service targets and keeps manual tasks', () => {
  const models = read('../src/app/features/staff-os/domain/staff-os.models.ts');
  const page = read('../src/app/pages/staff/staff-os-workspace/staff-os-workspace-page.component.ts');
  const template = read('../src/app/pages/staff/staff-os-workspace/staff-os-workspace-page.component.html');
  const backend = read('../../backend-rust/src/routes/staff_advanced.rs');
  const repository = read('../../backend-rust/src/repositories/staff_advanced_repository.rs');
  const migration = read('../../backend-rust/migrations/0271_staff_service_targets.sql');
  const staffService = read('../../staff-app/src/app/core/staff-app.service.ts');
  const staffTasks = read('../../staff-app/src/app/features/staff/staff-tasks.page.ts');

  assert.match(models, /label: 'Add task'.*postPath: '\/staff\/tasks'/);
  assert.match(page, /store\.get<StaffListResponse>\('\/staff\/list\?/);
  assert.match(page, /store\.get<ServiceOption\[]>\('\/services'/);
  assert.match(page, /store\.post\('\/staff\/service-targets'/);
  assert.match(page, /store\.post\('\/staff\/tasks'/);
  assert.match(page, /await this\.refresh\(\)/);
  assert.match(template, /Assign to/);
  assert.match(template, /Service category/);
  assert.match(template, /Target quantity/);
  assert.match(backend, /route\("\/staff\/tasks", get\(list_tasks\)\.post\(create_task\)\)/);
  assert.match(backend, /route\(\s*"\/staff\/service-targets"/);
  assert.match(backend, /route\(\s*"\/staff\/self\/service-targets",\s*get\(list_self_service_targets\),?\s*\)/);
  assert.match(backend, /async fn create_task[\s\S]+?ensure_manager_access\(&claims\)\?/);
  assert.match(repository, /FROM pos_sale_lines line/);
  assert.match(repository, /sale\.status NOT IN \('draft','cancelled','voided','refunded'\)/);
  assert.match(repository, /split\.value->>'staffId'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_service_targets/);
  assert.match(staffService, /async serviceTargets\(\)[\s\S]*?\/staff\/self\/service-targets/);
  assert.match(staffTasks, /target\.achievedCount.*target\.targetCount/);
});
