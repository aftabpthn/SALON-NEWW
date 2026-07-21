import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/app/pages/staff/', import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const files = [...walk(root), fileURLToPath(new URL('../src/app/pages/reports/staff-bookings/staff-bookings-report-page.component.html', import.meta.url))];
const english = readFileSync(new URL('../src/app/core/i18n/catalogs/en-in.ts', import.meta.url), 'utf8');
const hindi = readFileSync(new URL('../src/app/core/i18n/catalogs/hi-in.ts', import.meta.url), 'utf8');

test('staff templates use translated labels and responsive styles', () => {
  for (const file of files.filter((value) => value.endsWith('.component.html'))) assert.match(readFileSync(file, 'utf8'), /\| translate/);
  for (const file of files.filter((value) => value.endsWith('.component.css'))) assert.match(readFileSync(file, 'utf8'), /@media/);
});

test('staff message keys have English and Hindi parity', () => {
  const keys = [...english.matchAll(/'(staff\.(?:ui|message)\.[^']+)'\s*:/g)].map((match) => match[1]);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.ok(hindi.includes(`'${key}'`), `missing Hindi key ${key}`);
});
