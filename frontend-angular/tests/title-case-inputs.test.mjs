import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isTitleCaseField, titleCaseWords } from '../src/app/shared/utils/title-case-input.util.ts';

test('name-style fields use title case without changing protected fields', () => {
  assert.equal(titleCaseWords('WINE  PEDICURE'), 'Wine  Pedicure');
  assert.equal(titleCaseWords('aftab ahamad'), 'Aftab Ahamad');
  assert.equal(isTitleCaseField('firstName First name'), true);
  assert.equal(isTitleCaseField('productName Product name'), true);
  assert.equal(isTitleCaseField('categoryName Category'), true);
  assert.equal(isTitleCaseField('email Email'), false);
  assert.equal(isTitleCaseField('sku Product code'), false);
  assert.equal(isTitleCaseField('notes Notes'), false);
  assert.equal(isTitleCaseField('searchProduct Search product by name or code'), false);

  const root = readFileSync(new URL('../src/app/app.component.ts', import.meta.url), 'utf8');
  assert.match(root, /hostDirectives: \[TitleCaseInputsDirective\]/);
});
