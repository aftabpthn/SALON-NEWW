import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('POS checkout resolves branch label from authenticated branch context', () => {
  const component = read('src/app/pages/pos/pos-page.component.ts');
  const template = read('src/app/pages/pos/pos-page.component.html');

  assert.match(component, /AuthService/);
  assert.match(component, /private readonly auth: AuthService/);
  assert.match(component, /this\.refreshBranchName\(\);/);
  assert.match(component, /this\.auth\.branchNameFor\(branchId\)/);
  assert.match(component, /\|\|\s*branchId\s*\|\|\s*''/);
  assert.match(component, /const branchName = this\.resolvedBranchName\(\);/);
  assert.match(component, /branchName:\s*branchName\s*\|\|\s*null/);
  assert.match(template, /\[value\]="branchName"/);
});
