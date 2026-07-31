import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const service = read('../src/app/core/i18n/language.service.ts');
const header = read('../src/app/layout/app-header.component.html');
const settings = read('../src/app/pages/settings/settings-page.component.html');
const route = read('../../backend-rust/src/routes/language_settings.rs');
const repository = read('../../backend-rust/src/repositories/language_settings_repository.rs');
const migration = read('../../backend-rust/migrations/0214_language_region_settings.sql');

assert.match(header, /header\.languages' \| translate/);
assert.match(settings, /Language &amp; Region/);
assert.match(settings, /allowUserOverride/);
assert.match(service, /\/settings\/language\/me/);
assert.match(service, /\/settings\/language\/tenant/);
assert.doesNotMatch(service, /localStorage/, 'Language preference must come from the API');
assert.match(route, /settings\.manage/);
assert.match(repository, /WHERE tenant_id=\$1 AND branch_id='\*' AND user_id=\$2/);
assert.match(migration, /PRIMARY KEY \(tenant_id, user_id\)/);

console.log('Language Phase 2 wiring checks passed');
