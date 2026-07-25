import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.html', 'utf8');

test('cash drawer can open with an empty zero-value float', () => {
  assert.doesNotMatch(component, /openingCash === ''/);
  assert.match(component, /openingCash !== ''[\s\S]*Number\.isFinite/);
  assert.match(component, /openingCashPaise: this\.toPaise\(this\.openingCash\)/);
  assert.match(template, /Opening cash \(optional\)/);
});
