import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('training page exposes connected assignment and coaching actions', () => {
  const models = read('../src/app/features/staff-os/domain/staff-os.models.ts');
  const workspace = read('../src/app/pages/staff/staff-os-workspace/staff-os-workspace-page.component.ts');
  const routes = read('../../backend-rust/src/routes/staff_enterprise.rs');

  assert.match(models, /training: \{[\s\S]+path: '\/staff-enterprise\/training'/);
  assert.match(models, /training: \{[\s\S]+path: '\/staff\/coach\/goals'/);
  assert.match(models, /Assign training[\s\S]+postPath: '\/staff-enterprise\/training\/assign'/);
  assert.match(models, /Add coaching goal[\s\S]+postPath: '\/staff\/coach\/goals'/);
  assert.match(models, /key: 'targetValue', label: 'Target value'/);

  assert.match(workspace, /body\[field\.key\] = this\.actionValue\(field\.key, value\)/);
  assert.match(workspace, /private actionValue\(key: string, value: string\)/);
  assert.match(workspace, /Number\.isFinite\(number\) \? number : value/);

  assert.match(routes, /route\("\/staff-enterprise\/training", get\(training_assignments\)\)/);
  assert.match(routes, /route\("\/staff-enterprise\/training\/assign", post\(assign_training\)\)/);
  assert.match(routes, /"\/staff\/coach\/goals"[\s\S]+get\(list_coaching_goals\)\.post\(create_coaching_goal\)/);
});
