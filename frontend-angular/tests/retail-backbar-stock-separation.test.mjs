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
// The guard is what matters, not its wording: dual-use consumption must refuse
// to post until a sealed unit has been opened.
assert.ok(adjustment.includes('open the sealed tube before recording usage'));
assert.ok(adjustment.includes('open tube has insufficient remaining quantity'));
// dualUseStock is derived from the product usage rather than tracked as its own
// draft flag, so the two can never disagree.
assert.ok(inventory.includes("dualUseStock: this.productDraft.productUsage === 'dual_use'"));
assert.ok(template.includes('Retail / Backbar stock'));
// The dual-use choice now lives in the product-use selector rather than a
// separate checkbox with explanatory copy.
assert.ok(template.includes('value="dual_use"'));
