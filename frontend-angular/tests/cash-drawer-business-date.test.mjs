import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('cash drawer business dates are locked, strict, and report by stored business date', () => {
  const repository = read('../backend-rust/src/repositories/cash_drawer_repository.rs');
  const service = read('../backend-rust/src/services/cash_drawer_service.rs');
  const route = read('../backend-rust/src/routes/cash_drawer.rs');
  const reports = read('../backend-rust/src/routes/reports.rs');
  const component = read('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.ts');
  const template = read('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.html');

  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /WHERE NOT EXISTS \(SELECT 1 FROM cash_drawer_sessions WHERE tenant_id=\$1 AND branch_id=\$2 AND business_date=\$4\)/);
  assert.match(service, /ensure_business_day_unlocked/);
  assert.match(route, /businessDate is required/);
  assert.match(reports, /session\.business_date=\$3/);
  assert.match(template, /<as-date-picker/);
  assert.doesNotMatch(component, /toISOString\(\)\.slice\(0, 10\)/);
});
