import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../src/app/core/i18n/language.service.ts', import.meta.url), 'utf8');
const english = readFileSync(new URL('../src/app/core/i18n/catalogs/en-in.ts', import.meta.url), 'utf8');
const hindi = readFileSync(new URL('../src/app/core/i18n/catalogs/hi-in.ts', import.meta.url), 'utf8');
const keys = (source) => [...source.matchAll(/'([^']+)':/g)].map((match) => match[1]).sort();

const englishKeys = new Set(keys(english));
for (const key of keys(hindi)) assert.ok(englishKeys.has(key), `Hindi catalog has unknown key ${key}`);
assert.match(service, /import\('\.\/catalogs\/hi-in'\)/, 'Hindi must remain lazy-loaded');
assert.match(service, /\?\? english\[/, 'Missing translations must fall back to English');
assert.match(service, /`\$\{primary\} \/ \$\{secondary\}`/, 'Bilingual mode must render both labels');
assert.match(service, /documentElement\.dir/, 'Language changes must update document direction');
assert.match(service, /Intl\.DateTimeFormat/);
assert.match(service, /Intl\.NumberFormat/);

console.log('Language foundation checks passed');
