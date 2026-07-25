import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('cash drawer clears stale state and exposes honest section states', () => {
  const component = read('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.ts');
  const template = read('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.html');

  assert.match(component, /error: \(error\) => \{ if \(version !== this\.loadVersion\) return; this\.clearDrawerData\(\)/);
  assert.match(component, /sectionErrors = \{ staff: '', movements: '', tills: '', deposits: '', reconciliations: '', report: '' \}/);
  assert.match(component, /\/staff\/list\?\$\{params\.toString\(\)\}/);
  assert.match(component, /next: \(\) => \{ reset\(\); this\.busy = false; reload\(\)/);
  assert.match(template, /<as-date-picker/);
  assert.match(template, /displayDate\(businessDate\)/);
  assert.match(template, /sectionErrors\.deposits/);
  assert.match(template, /sectionErrors\.tills/);
  assert.match(template, /sectionErrors\.movements/);
  assert.match(template, /canApprove && deposit\.status === 'pending'/);
  assert.match(template, /changeStaffPage\(1\)/);
});
