import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Phase 3 transfers use one governed multi-shipment lifecycle', () => {
  const route = read('../backend-rust/src/routes/inventory_transfers.rs');
  const service = read('../backend-rust/src/services/inventory_transfer_service.rs');
  const governance = read('../backend-rust/src/repositories/inventory_governance_repository.rs');
  const migration = read('../backend-rust/migrations/0361_inventory_transfer_phase3.sql');
  const page = read('src/app/pages/inventory/inventory-page.component.html');

  for (const path of ['/raise', '/approve', '/dispatch', '/ship', '/receive', '/returns', '/cancel']) {
    assert.match(route, new RegExp(path));
  }
  assert.match(service, /maker-checker requires a different transfer approver/);
  assert.match(service, /allocate_fefo_quantity/);
  assert.match(service, /post_transfer_journals/);
  assert.match(governance, /auto_checkout_transfer_containers/);
  assert.match(migration, /inventory_transfer_shipments/);
  assert.match(migration, /reserved_retail_quantity/);
  assert.match(page, /Pull \/ request transfer/);
  assert.match(page, /Auto checkout/);
  assert.match(page, /Damaged \/ Expired \/ Short/);
});
