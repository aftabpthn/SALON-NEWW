import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/app/pages/marketing/marketing-leads-page.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/pages/marketing/marketing-leads-page.component.html', import.meta.url), 'utf8');

test('social publisher uses the durable API queue and renders provider status', () => {
  assert.match(page, /\/marketing\/social-publications/);
  assert.match(page, /idempotencyKey: `social-/);
  assert.match(page, /cancelSocialPublication/);
  assert.match(page, /retrySocialPublication/);
  assert.match(template, /Social Publisher/);
  assert.match(page, /Instagram requires/);
  assert.match(template, /row\.status === 'uncertain'/);
});
