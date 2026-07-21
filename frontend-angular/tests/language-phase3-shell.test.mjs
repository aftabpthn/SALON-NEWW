import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const english = read('../src/app/core/i18n/catalogs/en-in.ts');
const hindi = read('../src/app/core/i18n/catalogs/hi-in.ts');
const sidebarSource = read('../src/app/layout/app-sidebar.component.ts');
const sidebarTemplate = read('../src/app/layout/app-sidebar.component.html');
const header = read('../src/app/layout/app-header.component.html');
const datePicker = read('../src/app/shared/date-picker/date-picker.component.ts');
const languageService = read('../src/app/core/i18n/language.service.ts');
const catalogKeys = (source) => new Set([...source.matchAll(/'([^']+)':/g)].map((match) => match[1]));
const englishKeys = catalogKeys(english);
const hindiKeys = catalogKeys(hindi);
const navigationLabels = new Set([...sidebarSource.matchAll(/label: '([^']+)'/g)].map((match) => match[1]));

for (const label of navigationLabels) {
  assert(englishKeys.has(`nav.${label}`), `Missing English navigation key: ${label}`);
  assert(hindiKeys.has(`nav.${label}`), `Missing Hindi navigation key: ${label}`);
}

for (const key of ['common.save', 'common.deleteConfirm', 'common.loading', 'common.noRecords', 'common.permissionDenied', 'error.validation']) {
  assert(englishKeys.has(key) && hindiKeys.has(key), `Missing shared key: ${key}`);
}

assert.match(sidebarTemplate, /'nav\.' \+ group\.label \| translate/);
assert.match(header, /header\.aiReceptionist' \| translate/);
assert.match(datePicker, /MM\/DD\/YYYY/);
assert.match(datePicker, /YYYY-MM-DD/);
assert.match(languageService, /apiError\(error/);

console.log('Language Phase 3 shell checks passed');
