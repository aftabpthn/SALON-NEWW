import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('staff services support real category grouping and bulk assignment', () => {
  const page = read('../src/app/pages/staff/staff-page.component.ts');
  const template = read('../src/app/pages/staff/staff-page.component.html');

  assert.match(page, /item\.category\.trim\(\) \|\| 'Uncategorized'/);
  assert.match(page, /setServicesAssigned\(items: CatalogOption\[], assigned: boolean\)/);
  assert.match(template, />All services</);
  assert.match(template, />All categories</);
  assert.match(template, /setServicesAssigned\(group\.items, true\)/);
  assert.match(template, /setServicesAssigned\(group\.items, false\)/);
});
