import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../src/app/pages/inventory/inventory-page.component.ts');
const template = read('../src/app/pages/inventory/inventory-page.component.html');
const english = read('../src/app/core/i18n/catalogs/en-in.ts');
const hindi = read('../src/app/core/i18n/catalogs/hi-in.ts');
const languageService = read('../src/app/core/i18n/language.service.ts');

test('inventory product register uses the shared language service and pipe', () => {
  assert.match(page, /inject\(LanguageService\)/);
  assert.match(page, /formatCurrency/);
  assert.match(page, /formatDate/);
  assert.match(template, /item\.labelKey \| translate/);
  assert.match(template, /inventory\.showingRecords.*translate/);
});

test('inventory exports translate catalog-backed headings', () => {
  assert.match(languageService, /textValue\(value: string\)/);
  assert.match(page, /headers.*rows/);
  assert.match(page, /\.map\(\(value\) => this\.language\.textValue\(value\)\)/);
});

test('inventory phase 4 keys exist in English and Hindi', () => {
  for (const key of [
    'inventory.title', 'inventory.products', 'inventory.searchNameSku',
    'inventory.totalItems', 'inventory.stockValue', 'inventory.skuBarcode',
    'inventory.errors.procurementLoad',
  ]) {
    assert.ok(english.includes(`'${key}'`), `missing English key ${key}`);
    assert.ok(hindi.includes(`'${key}'`), `missing Hindi key ${key}`);
  }
});
