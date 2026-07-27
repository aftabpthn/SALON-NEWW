import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../src/app/pages/inventory/inventory-page.component.ts');
const template = read('../src/app/pages/inventory/inventory-page.component.html');

for (const field of [
  'discountBps',
  'shippingPaise',
  'handlingPaise',
  'supplierInvoiceDate',
  'challanNumber',
  'deliveryReference',
  'damagedQuantity',
  'rejectedQuantity',
  'varianceReason',
]) assert.ok(page.includes(field), `purchase payload must include ${field}`);

for (const label of [
  'Line discount %',
  'Supplier invoice date',
  'Challan number',
  'Delivery reference',
  'Damaged quantity',
  'Rejected quantity',
  'Scan product barcode',
  'Short',
  'Excess',
]) assert.ok(template.includes(label), `purchase drawer must show ${label}`);

assert.ok(page.includes("workflow: 'receive'"), 'GRN scanner must reuse the persisted receive scanner workflow');
assert.ok(page.includes('Number(line.damagedQuantity || 0) - Number(line.rejectedQuantity || 0)'), 'accepted stock must exclude damaged and rejected quantities');

const service = read('../../backend-rust/src/services/purchase_service.rs');
const migration = read('../../backend-rust/migrations/0268_advanced_receiving.sql');
for (const contract of ['proportional_allocations', 'landed_unit_cost_paise', 'create_receiving_quarantine']) assert.ok(service.includes(contract), `backend must wire ${contract}`);
for (const column of ['rejected_quantity', 'landed_cost_paise', 'inventory_receiving_quarantine']) assert.ok(migration.includes(column), `migration must persist ${column}`);
