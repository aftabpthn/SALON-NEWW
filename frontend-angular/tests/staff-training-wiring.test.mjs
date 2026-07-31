import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('training page exposes connected assignment and coaching actions', () => {
  const models = read('../src/app/features/staff-os/domain/staff-os.models.ts');
  const workspace = read('../src/app/pages/staff/staff-os-workspace/staff-os-workspace-page.component.ts');
  const template = read('../src/app/pages/staff/staff-os-workspace/staff-os-workspace-page.component.html');
  const routes = read('../../backend-rust/src/routes/staff_enterprise.rs');
  const service = read('../../backend-rust/src/services/staff_enterprise_service.rs');

  assert.match(models, /training: \{[\s\S]+path: '\/staff-enterprise\/training'/);
  assert.match(models, /training: \{[\s\S]+path: '\/staff\/coach\/goals'/);
  assert.match(models, /Assign training[\s\S]+postPath: '\/staff-enterprise\/training\/assign'/);
  assert.match(models, /Add coaching goal[\s\S]+postPath: '\/staff\/coach\/goals'/);
  assert.match(models, /key: 'targetValue', label: 'Target value'/);

  // Staff is picked from a dropdown, never a typed-in id, so both actions bind to a staff field.
  assert.match(models, /Assign training[\s\S]+key: 'staffId', label: 'Staff', type: 'staff'/);
  assert.match(models, /Add coaching goal[\s\S]+key: 'staffId', label: 'Staff', type: 'staff'/);

  assert.match(workspace, /body\[field\.key\] = this\.fieldValue\(field, raw\)/);
  assert.match(workspace, /private fieldValue\(field: StaffOsActionField, raw: string\): unknown/);
  assert.match(workspace, /Number\.isFinite\(number\) \? number : raw/);
  assert.match(workspace, /private async ensureStaffOptions\(\)/);
  assert.doesNotMatch(workspace, /window\.prompt/);
  assert.match(template, /actionDrawerOpen && activeAction/);
  assert.match(template, /\(ngModelChange\)="actionValues\[field\.key\] = (?:String\(\$event \?\? ''\)|\$event\?\.toString\(\) \?\? '')"/);
  assert.match(template, /@for \(staff of staffOptions; track staff\.id\)[\s\S]+staffOptionLabel\(staff\)/);

  assert.match(models, /options: \['revenue', 'appointments', 'rebooking', 'attendance', 'training', 'utilization', 'custom'\]/);
  assert.match(models, /options: \['count', 'percent', 'minutes', 'paise'\]/);
  for (const goalType of ['revenue', 'appointments', 'rebooking', 'attendance', 'training', 'utilization', 'custom']) {
    assert.ok(service.includes(`"${goalType}"`), `missing backend goal type ${goalType}`);
  }
  assert.match(service, /&\["count", "percent", "minutes", "paise"\]/);

  assert.match(routes, /route\("\/staff-enterprise\/training", get\(training_assignments\)\)/);
  assert.match(routes, /route\("\/staff-enterprise\/training\/assign", post\(assign_training\)\)/);
  assert.match(routes, /"\/staff\/coach\/goals"[\s\S]+get\(list_coaching_goals\)\.post\(create_coaching_goal\)/);
});
