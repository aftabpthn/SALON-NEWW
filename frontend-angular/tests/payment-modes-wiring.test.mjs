import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/pages/pos/payment-modes/pos-payment-modes-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/pos/payment-modes/pos-payment-modes-page.component.html', 'utf8');
const backend = readFileSync('../backend-rust/src/routes/pos.rs', 'utf8');
const repo = readFileSync('../backend-rust/src/repositories/payment_methods_repository.rs', 'utf8');

test('payment modes page initializes and manages backend-backed modes', () => {
  assert.match(backend, /"\/settings\/payment-methods\/initialize"/);
  assert.match(repo, /ensure_defaults/);
  assert.match(page, /\/settings\/payment-methods\/initialize/);
  assert.match(page, /if \(!this\.modes\.length && !this\.initializedDefaults\) this\.initializeDefaults\(\)/);
  assert.match(page, /this\.api\.patch\(`\/settings\/payment-methods\/\$\{gaps\[index\]\.id\}`/);
  assert.match(template, /name="modeSearch"/);
  assert.match(template, /name="statusFilter"/);
});

test('payment modes expose reference audit gaps used by checkout and invoices', () => {
  assert.match(page, /referenceRecommended\(settlementType: string\)/);
  assert.match(page, /\['upi', 'card', 'bank_transfer', 'gift_card', 'store_credit'\]/);
  assert.match(page, /onSettlementTypeChange\(\)/);
  assert.match(template, /\(change\)="onSettlementTypeChange\(\)"/);
  assert.match(template, /Fix reference gaps/);
  assert.match(template, /referenceRecommendation\(mode\)/);
  assert.match(backend, /if mode\.reference_required && payment\.reference\.trim\(\)\.is_empty\(\)/);
});
