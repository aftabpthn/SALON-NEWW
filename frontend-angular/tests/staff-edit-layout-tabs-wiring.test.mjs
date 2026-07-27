import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('staff edit page uses four-field desktop layout and reloads live tab data', () => {
  const component = read('../src/app/pages/staff/staff-page.component.ts');
  const styles = read('../src/app/pages/staff/staff-page.component.css');

  assert.match(styles, /\.staff-drawer\.page-mode \.form-grid \{ grid-template-columns:repeat\(4,minmax\(0,1fr\)\); \}/);
  assert.match(component, /tab === 'Documents'[\s\S]*void this\.loadDocuments\(\)/);
  assert.match(component, /tab === 'History'[\s\S]*void this\.loadHistory\(\)/);
  assert.match(component, /tab === 'Branch Access'[\s\S]*void this\.loadBranchAccess\(\)/);
  assert.match(component, /tab === 'Operations'[\s\S]*void this\.loadOperations\(true\)/);
});
