import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('login shows the real subscription denial without creating a session', () => {
  const component = read('../src/app/pages/security/login/login-page.component.ts');
  const template = read('../src/app/pages/security/login/login-page.component.html');

  assert.match(component, /details\?\.subscriptionStatus/);
  assert.match(component, /error\?\.status === 403/);
  assert.match(component, /Subscription expired/);
  assert.match(template, /@if \(subscriptionStatus\)/);
  assert.doesNotMatch(template, /Subscribe|Buy plan/);
});
