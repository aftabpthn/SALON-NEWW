import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/pages/data-migration/csv-import.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parseCsv } = await import(`data:text/javascript,${encodeURIComponent(js)}`);

test('CSV import preserves quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('firstName,notes\r\nAftab,"Hair, Skin"\r\nSara,"She said ""yes"""'), [
    ['firstName', 'notes'],
    ['Aftab', 'Hair, Skin'],
    ['Sara', 'She said "yes"'],
  ]);
});
