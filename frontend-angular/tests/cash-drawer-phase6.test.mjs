import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('cash drawer actions refresh other terminals through scoped POS realtime', () => {
  const route = read('../backend-rust/src/routes/cash_drawer.rs');
  const realtimeRoute = read('../backend-rust/src/routes/realtime.rs');
  const middleware = read('../backend-rust/src/middleware/tenant.rs');
  const realtimeService = read('src/app/core/services/pos-realtime.service.ts');
  const environment = read('src/environments/environment.ts');
  const proxyConfig = read('proxy.conf.json');
  const component = read('src/app/pages/pos/cash-drawer/pos-cash-drawer-page.component.ts');

  for (const action of [
    'drawer.opened', 'drawer.movement_recorded', 'drawer.close_requested',
    'drawer.deposit_confirmed', 'drawer.reconciliation_reviewed', 'drawer.till_approved',
  ]) assert.match(route, new RegExp(action.replace('.', '\\.')));

  assert.match(route, /publish_pos_event\(tenant_id, branch_id, "cash_drawer"/);
  assert.match(realtimeRoute, /event\.tenant_id == tenant_id/);
  assert.match(realtimeRoute, /branch_id\.is_empty\(\) \|\| event\.branch_id == branch_id/);
  assert.match(realtimeService, /'cash_drawer'/);
  assert.match(realtimeService, /environment\.realtimeWsBaseUrl/);
  assert.match(environment, /realtimeWsBaseUrl: ''/);
  assert.match(proxyConfig, /"ws": false/);
  assert.match(component, /this\.realtime\.events\(\)\.subscribe/);
  assert.match(component, /event\.entityType === 'cash_drawer'/);
  assert.match(component, /event\.action === 'invoice\.refunded'/);
  assert.match(component, /ngOnDestroy\(\).*unsubscribe/);
  assert.match(component, /hasRole\([^\n]*'cashier'/);
  assert.match(middleware, /CASH_DRAWER_WRITE_ROLES[\s\S]*"cashier"/);
});

