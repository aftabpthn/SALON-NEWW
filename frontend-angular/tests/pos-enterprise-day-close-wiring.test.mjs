import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/pages/pos/enterprise/pos-enterprise-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/pos/enterprise/pos-enterprise-page.component.html', 'utf8');
const backend = readFileSync('../backend-rust/src/routes/pos_enterprise.rs', 'utf8');
const service = readFileSync('../backend-rust/src/services/pos_enterprise_service.rs', 'utf8');

test('enterprise day close uses shared date and API-safe business date', () => {
  assert.match(page, /DatePickerComponent/);
  assert.match(page, /businessDate = this\.toIsoDate\(new Date\(\)\)/);
  assert.match(page, /private isoDate\(\): string \{ return \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(this\.businessDate\)/);
  assert.match(template, /<as-date-picker/);
  assert.doesNotMatch(template, /placeholder="DD\/MM\/YYYY"/);
});

test('enterprise lock workflow reflects the shared branch drawer prerequisite', () => {
  assert.match(page, /drawerReadyForLock/);
  assert.match(page, /Close and approve the branch cash drawer before locking the day/);
  assert.match(template, /Branch cash drawer must be closed and approved before lock\/Z-report/);
  assert.match(template, /\[disabled\]="busy \|\| !drawerReadyForLock"/);
  assert.match(backend, /cash drawers must be closed before locking the day/);
  assert.match(service, /all cash drawers must be closed and approved before Z-report generation/);
});
