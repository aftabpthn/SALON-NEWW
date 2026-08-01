import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Phase 2 purchase receiving stays on the shared PO and GRN flow', () => {
  const route = read('../backend-rust/src/routes/purchases.rs');
  const service = read('../backend-rust/src/services/purchase_service.rs');
  const migration = read('../backend-rust/migrations/0358_purchase_receiving_phase2.sql');
  const page = read('src/app/pages/inventory/inventory-page.component.html');

  for (const path of [
    '/purchases/orders/import',
    '/purchases/grn/:id/barcode-labels',
    '/purchases/price-update-requests/:id/review',
  ]) assert.match(route, new RegExp(path.replace(/[/:]/g, '\\$&')));

  assert.match(service, /excess receiving permission and explicit acceptance are required/);
  assert.match(service, /price update requester cannot approve their own request/);
  assert.match(service, /one CSV import can contain only one VendorCode/);
  assert.match(migration, /quantity=retail_quantity\+consumable_quantity/);
  assert.match(migration, /purchase_price_update_requests/);
  assert.match(page, /Import PO CSV/);
  assert.match(page, /Retail received/);
  assert.match(page, /Print labels/);
  assert.match(page, /Pending master price updates/);
});
