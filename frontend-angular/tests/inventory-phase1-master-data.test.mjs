import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const frontend = path.resolve(import.meta.dirname, '..');
const root = path.resolve(frontend, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('inventory Phase 1 master data is persisted and wired to existing workflows', () => {
  const migration = read('backend-rust/migrations/0357_inventory_zenoti_phase1_master_data.sql');
  const product = read('frontend-angular/src/app/pages/inventory/inventory-page.component.ts');
  const controls = read('frontend-angular/src/app/pages/inventory/advanced-controls/advanced-controls-page.component.ts');
  const purchases = read('backend-rust/src/services/purchase_service.rs');

  for (const field of ['product_usage', 'subcategory', 'center_available', 'alert_level', 'desired_level', 'order_level', 'safety_stock_level']) assert.match(migration, new RegExp(field));
  for (const table of ['inventory_item_barcodes', 'inventory_uom_master', 'inventory_master_values']) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(product, /\/inventory\/master-data/);
  assert.match(product, /barcodesText/);
  assert.match(product, /vendorPartNumber/);
  assert.match(product, /conversionQuantity/);
  assert.match(controls, /partialDeliveryPolicy/);
  assert.match(controls, /masterEditLock/);
  assert.match(purchases, /vendor-product-center association is inactive or unavailable/);
  assert.match(purchases, /partial delivery is blocked by inventory policy/);
  assert.match(purchases, /inventory financial lock period/);
});
