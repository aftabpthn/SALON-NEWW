import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('client timeline shows invoice service and product lines with staff', () => {
  const repository = read('../../backend-rust/src/repositories/clients_repository.rs');
  const component = read('../src/app/pages/clients/clients-page.component.ts');
  const template = read('../src/app/pages/clients/clients-page.component.html');

  assert.match(repository, /line\.line_type IN \('service','product'\)/);
  assert.match(repository, /'staffName'.*line_items/s);
  assert.match(component, /lineItems: invoice\?\.lineItems/);
  assert.match(template, /event\.lineItems.*Staff:/s);
});
