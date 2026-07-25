import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const frontend = path.resolve(import.meta.dirname, '..');
const backend = path.resolve(frontend, '..', 'backend-rust');

test('reorder forecast renders real inventory stock and reorder levels', () => {
  const repository = fs.readFileSync(
    path.join(backend, 'src/repositories/inventory_reorder_forecast_repository.rs'),
    'utf8',
  );
  const component = fs.readFileSync(
    path.join(frontend, 'src/app/pages/inventory/inventory-page.component.ts'),
    'utf8',
  );

  assert.match(repository, /item\.stock_quantity current_stock/);
  assert.match(repository, /item\.reorder_point reorder_level/);
  assert.match(repository, /supplier_score_bps DESC NULLS LAST/);
  for (const metric of ['on_time_rate_bps', 'fill_rate_bps', 'return_rate_bps', 'expiry_risk_bps']) {
    assert.match(repository, new RegExp(metric));
  }
  assert.match(component, /currentStock: row\.currentStock/);
  assert.match(component, /reorderLevel: row\.reorderLevel/);
  assert.doesNotMatch(component, /currentStock: 0, reorderLevel: 0/);
});
