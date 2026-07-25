import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('staff creation generates a locked tenant-unique employee code', () => {
  const template = read('../src/app/pages/staff/staff-page.component.html');
  const component = read('../src/app/pages/staff/staff-page.component.ts');
  const route = read('../../backend-rust/src/routes/staff.rs');
  const createRoute = route.slice(route.indexOf('async fn create_staff('), route.indexOf('async fn update_staff('));
  const repository = read('../../backend-rust/src/repositories/staff_repository.rs');
  const migration = read('../../backend-rust/migrations/0003_auth_crm_foundation.sql');

  assert.match(template, /\[readonly\]="!editingId"[^>]+Generated on save/);
  assert.match(component, /employeeCode: this\.editingId \?/);
  assert.doesNotMatch(component, /Employee code is required when cloning/);
  assert.doesNotMatch(createRoute, /employee_code: payload/);
  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /MAX\(employee_code::BIGINT\)/);
  assert.match(migration, /idx_staff_tenant_employee_code/);
});
