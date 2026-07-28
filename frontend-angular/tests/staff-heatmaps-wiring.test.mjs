import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('staff heatmaps use connected report APIs and compact IDs', () => {
  const models = read('../src/app/features/staff-os/domain/staff-os.models.ts');
  const component = read('../src/app/pages/staff/staff-os-workspace/staff-os-workspace-page.component.ts');
  const template = read('../src/app/pages/staff/staff-os-workspace/staff-os-workspace-page.component.html');
  const repository = read('../../backend-rust/src/repositories/staff_enterprise_repository.rs');

  assert.match(models, /path: '\/staff-enterprise\/floor-control\?date=\{today\}'.*columns: \['staffId', 'staffName', 'scheduleStatus'/);
  assert.match(models, /path: '\/staff\/reports\/attendance\?\{period\}'.*columns: \['staffName', 'staffId', 'days', 'presentDays'/);

  assert.match(component, /display\(value: unknown, column = ''\)/);
  assert.match(component, /isIdColumn\(column: string\)/);
  assert.match(component, /shortId\(value: string\)/);
  assert.match(template, /display\(row\[column\], column\)/);
  assert.match(template, /\[attr\.title\]="display\(row\[column\]\)"/);

  assert.doesNotMatch(repository, /ORDER BY 1->>'staffName'/);
  assert.match(repository, /ORDER BY row->>'staffName'/);
});
