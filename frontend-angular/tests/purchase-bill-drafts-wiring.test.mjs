import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('AI bill draft page is routed and API-backed', () => {
  const routes = read('src/app/app.routes.ts');
  const page = read('src/app/pages/inventory/purchase-bill-drafts/purchase-bill-drafts-page.component.ts');
  const template = read('src/app/pages/inventory/purchase-bill-drafts/purchase-bill-drafts-page.component.html');
  assert.match(routes, /path: 'purchase-bill-drafts'/);
  assert.match(page, /\/purchases\/bill-drafts\/upload/);
  assert.match(page, /getBlob\(\`\/purchases\/bill-drafts\/\$\{id\}\/source\`\)/);
  assert.match(page, /\/confirm/);
  assert.match(page, /\/match/);
  assert.match(page, /\/purchases\/suppliers/);
  assert.match(page, /post<ApiEnvelope<Item>>\('\/inventory'/);
  assert.match(page, /new URLSearchParams\(\{ page: '1', pageSize: '100'/);
  assert.match(page, /params\.set\('q', query\.trim\(\)\)/);
  assert.match(template, /review-gates/);
  assert.match(template, /previewSafeUrl/);
  assert.match(template, /Extraction evidence/);
  assert.match(template, /Create and link inventory item/);
  assert.doesNotMatch(page, /mock|dummy|sample/i);
});

test('purchase order completion actions and timeline are wired', () => {
  const page = read('src/app/pages/inventory/inventory-page.component.ts');
  const template = read('src/app/pages/inventory/inventory-page.component.html');
  for (const action of ['send', 'close', 'cancel', 'reopen']) {
    assert.match(page, new RegExp(`'${action}'`));
    assert.match(template, new RegExp(`orderAction\\(row, '${action}'\\)`));
  }
  assert.match(page, /\/events/);
  assert.match(template, /Immutable|timeline/i);
});
