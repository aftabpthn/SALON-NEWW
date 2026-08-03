import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('Phase 12 cash register and EOD controls are fail-closed and traceable', () => {
  const migration = read('../backend-rust/migrations/0401_cash_register_eod_controls.sql');
  const drawerRepository = read('../backend-rust/src/repositories/cash_drawer_repository.rs');
  const drawerService = read('../backend-rust/src/services/cash_drawer_service.rs');
  const drawerRoute = read('../backend-rust/src/routes/cash_drawer.rs');
  const enterpriseRoute = read('../backend-rust/src/routes/pos_enterprise.rs');
  const enterpriseService = read('../backend-rust/src/services/pos_enterprise_service.rs');
  const drawerPage = read('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.ts');
  const enterprisePage = read('src/app/pages/pos/enterprise/pos-enterprise-page.component.ts');

  assert.match(migration, /cash_drawer_close_snapshots/);
  assert.match(migration, /prevent_immutable_pos_close_evidence_mutation/);
  assert.match(migration, /pos_day_lock_events/);
  assert.match(migration, /terminal_id TEXT REFERENCES pos_terminals/);
  assert.match(drawerRepository, /previous_unclosed/);
  assert.match(drawerService, /manager holiday exception and notes are required/);
  assert.match(drawerService, /persist_close_snapshot/);
  assert.match(drawerRoute, /cash-control-settings|cash_control_settings/);
  assert.match(enterpriseService, /invoicePaymentGapPaise/);
  assert.match(enterpriseService, /invoiceAccountingGapPaise/);
  assert.match(enterpriseService, /paymentAccountingGapPaise/);
  assert.match(enterpriseService, /registerGapPaise/);
  assert.match(enterpriseRoute, /only a locked business day can be reopened/);
  assert.match(drawerPage, /terminalId: this\.tillTerminalId \|\| null/);
  assert.match(enterprisePage, /get eodReady\(\): boolean/);
});
