import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(`src/app/pages/${path}`, 'utf8');
const block = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('shared all-page loader uses bounded parallel pagination when total is known', () => {
  const api = readFileSync('src/app/shared/services/api.service.ts', 'utf8');
  const loader = block(api, 'async getAllPages<T>', 'private url(');
  assert.match(loader, /const first = await loadPage\(1\)/);
  assert.match(loader, /page \+= 4/);
  assert.match(loader, /Math\.min\(4, totalPages - page \+ 1\)/);
  assert.match(loader, /await Promise\.all\(batch\)/);
});

test('inventory route loaders render primary data before secondary references', () => {
  const inventory = read('inventory/inventory-page.component.ts');
  const reload = block(inventory, 'async reload()', 'selectTab(');
  assert.match(reload, /\['products','suppliers','orders','grn','transfers'\]\.includes\(tab\)\) await references/);
  assert.match(reload, /else await this\.loadOperationalTab/);
  assert.match(reload, /tab === 'products'[\s\S]*this\.loadOperationalTab/);
  assert.match(inventory, /private defer<T>/);

  const cases = [
    ['suppliers/suppliers-page.component.ts', 'async reload()', 'openCreate()', /void this\.loadMetrics/],
    ['inventory/backbar-consumption/backbar-consumption-page.component.ts', 'async load()', 'openRecord()', /void this\.loadFormOptions/],
    ['inventory/advanced-controls/advanced-controls-page.component.ts', 'async reload()', 'async savePolicy()', /void this\.loadSupportingData/],
    ['inventory/backbar-containers/backbar-container-control-page.component.ts', 'async load()', 'openRegister()', /backbar\.items\(\)\.then/],
    ['inventory/service-recipes/service-recipes-page.component.ts', 'async load()', 'newRecipe()', /void this\.loadSupportingData/],
    ['inventory/laundry-tracker/laundry-tracker-page.component.ts', 'async reload()', 'openCreate()', /void this\.loadReferences/],
    ['inventory/purchase-bill-drafts/purchase-bill-drafts-page.component.ts', 'async reload(', 'async upload(', /void this\.loadReferences/],
  ];

  for (const [path, start, end, expected] of cases) assert.match(block(read(path), start, end), expected, path);
  const supporting = block(read('inventory/advanced-controls/advanced-controls-page.component.ts'), 'private async loadSupportingData()', 'async savePolicy()');
  assert.match(supporting, /Promise\.allSettled/);
  for (const result of ['policy', 'negativeRequests', 'operations', 'autonomous']) assert.match(supporting, new RegExp(`${result}\\.status === 'fulfilled'`));
});

test('single-purpose GL and scanner loaders stay focused', () => {
  const gl = block(read('inventory/gl-reconciliation/gl-reconciliation-page.component.ts'), 'async runReconciliation()', 'reviewExceptions()');
  assert.equal((gl.match(/this\.api\.get</g) || []).length, 1);

  const scanner = block(read('inventory/scanner/inventory-scanner-page.component.ts'), 'async loadScannerState()', 'async submitScan(');
  assert.match(scanner, /scanner-events/);
  assert.match(scanner, /stock-audits/);
  assert.doesNotMatch(scanner, /getAllPages/);
});
