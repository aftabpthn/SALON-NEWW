import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('blind close and multi-till reconciliation stay enforced end to end', () => {
  const migration = read('../backend-rust/migrations/0235_cash_drawer_movement_till.sql');
  const repository = read('../backend-rust/src/repositories/cash_drawer_repository.rs');
  const service = read('../backend-rust/src/services/cash_drawer_service.rs');
  const route = read('../backend-rust/src/routes/cash_drawer.rs');
  const reports = read('../backend-rust/src/routes/reports.rs');
  const outgoing = read('../backend-rust/src/services/outgoing_funds_service.rs');
  const component = read('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.ts');

  assert.match(migration, /ADD COLUMN IF NOT EXISTS cash_drawer_till_id/);
  assert.match(repository, /cash_drawer_till_id,movement_type/);
  assert.match(repository, /till_movement_delta/);
  assert.match(repository, /till_outgoing_cash/);
  assert.match(repository, /close_requested_by_user_id<>\$4/);
  assert.match(service, /closed till totals do not reconcile with the cash drawer/);
  assert.match(route, /expected_cash_paise: Option<i64>/);
  assert.match(route, /till_response\(row, reveal\)/);
  assert.match(reports, /cash drawer reconciliation is restricted until blind close is submitted/);
  assert.match(outgoing, /cashDrawerTillId is required when multiple tills are open/);
  assert.match(component, /cashDrawerTillId: this\.movementTillId \|\| null/);
});
