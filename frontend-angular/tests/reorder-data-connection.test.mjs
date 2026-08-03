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
  const template = fs.readFileSync(
    path.join(frontend, 'src/app/pages/inventory/inventory-page.component.html'),
    'utf8',
  );
  const inventoryRepository = fs.readFileSync(
    path.join(backend, 'src/repositories/inventory_repository.rs'),
    'utf8',
  );
  const controls = fs.readFileSync(
    path.join(backend, 'src/services/inventory_controls_service.rs'),
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
  assert.match(component, /get<ReorderRow\[]>\('\/inventory\/reorder-suggestions'\)/);
  assert.match(component, /pendingTransferQuantity: Number\(row\.explanation\['pendingTransferQuantity'\]/);
  assert.match(inventoryRepository, /pending_po_quantity/);
  assert.match(inventoryRepository, /pending_transfer_quantity/);
  assert.match(controls, /desired_level[\s\S]*undelivered_quantity[\s\S]*recommended_quantity/);
  assert.match(component, /await this\.loadOperationalTab\('orders'\)/);
  assert.match(template, /onReorderPriorityChange\(\$event\)/);
  assert.match(template, /PO draft created/);
  assert.match(template, /PO \{\{ row\.pendingPoQuantity \}\} · TO \{\{ row\.pendingTransferQuantity \}\}/);
  assert.doesNotMatch(component, /currentStock: 0, reorderLevel: 0/);
});
