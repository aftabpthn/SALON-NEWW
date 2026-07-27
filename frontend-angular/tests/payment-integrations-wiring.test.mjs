import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/pages/pos/payment-integrations/payments-integrations-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/pos/payment-integrations/payments-integrations-page.component.html', 'utf8');
const backend = readFileSync('../backend-rust/src/routes/payment_platform.rs', 'utf8');
const catalog = readFileSync('../backend-rust/src/routes/pos_enterprise.rs', 'utf8');

test('payment integrations use real provider catalog and platform health', () => {
  assert.match(catalog, /"\/pos\/payment-providers"/);
  assert.match(backend, /"\/pos\/payment-platform\/overview"/);
  assert.match(page, /\/pos\/payment-providers\?refresh=/);
  assert.match(page, /\/pos\/payment-platform\/overview/);
  assert.match(page, /providerSetup = platform\.data\?\.providers \?\? \{\}/);
  assert.match(template, />Pending ops</);
  assert.match(template, />Failed ops</);
  assert.match(template, />Open disputes</);
});

test('available providers open setup health instead of dead navigation', () => {
  assert.match(template, /\(click\)="openProvider\(provider\)"/);
  assert.doesNotMatch(template, /routerLink="\/pos\/payment-modes">\{\{ actionLabel\(provider\) \}\}/);
  assert.match(template, /aria-label="Provider setup health"/);
  assert.match(page, /setupRows\(provider: PaymentProviderRow\)/);
  assert.match(page, /setupHint\(provider: PaymentProviderRow\)/);
  assert.match(page, /canStartHostedOnboarding\(provider: PaymentProviderRow\)/);
});
