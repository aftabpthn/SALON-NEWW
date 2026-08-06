import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/app/pages/data-migration/integrations-data-page.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/pages/data-migration/integrations-data-page.component.html', import.meta.url), 'utf8');

test('Meta connector collects encrypted-token inputs through the existing connector route', () => {
  assert.match(page, /provider: 'quickbooks'.*'meta'/);
  assert.match(page, /connectors\/\$\{row\.provider\}\/credentials/);
  assert.match(page, /pageId: draft\.pageId\.trim\(\)/);
  assert.match(page, /instagramBusinessAccountId:/);
  assert.match(template, /Page access token/);
  assert.match(template, /Graph API base URL/);
});
