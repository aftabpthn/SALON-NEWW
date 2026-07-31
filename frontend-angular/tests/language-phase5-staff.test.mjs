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

test('staff pages keep responsive styles', () => {
  for (const file of files.filter((value) => value.endsWith('.component.css'))) assert.match(readFileSync(file, 'utf8'), /@media/);
});

test('Hindi staff message keys exist in the English fallback catalog', () => {
  const keys = [...english.matchAll(/'(staff\.(?:ui|message)\.[^']+)'\s*:/g)].map((match) => match[1]);
  const hindiKeys = [...hindi.matchAll(/'(staff\.(?:ui|message)\.[^']+)'\s*:/g)].map((match) => match[1]);
  assert.ok(keys.length > 0);
  for (const key of hindiKeys) assert.ok(keys.includes(key), `unknown Hindi key ${key}`);
});
