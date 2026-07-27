import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../backend-rust/migrations/0265_inventory_dual_use_stock_buckets.sql');
const adjustment = read('../../backend-rust/src/services/inventory_adjustment_service.rs');
const inventory = read('../src/app/pages/inventory/inventory-page.component.ts');
const template = read('../src/app/pages/inventory/inventory-page.component.html');

assert.ok(migration.includes('dual_use_stock BOOLEAN NOT NULL DEFAULT FALSE'));
assert.ok(migration.includes('NEW.stock_quantity < sealed_quantity'));
assert.ok(migration.includes("NEW.status='sealed'"));
assert.ok(adjustment.includes('dual-use backbar consumption must be posted against the open container'));
assert.ok(inventory.includes('dualUseStock: this.productDraft.dualUseStock'));
assert.ok(template.includes('Retail / Backbar stock'));
assert.ok(template.includes('Same SKU is sold at retail and used in backbar'));
