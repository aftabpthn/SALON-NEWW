import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('stock audit exposes cutoff values and monetary approval policy', () => {
  const service = read('../../backend-rust/src/services/stock_audit_service.rs');
  const migration = read('../../backend-rust/migrations/0297_inventory_stock_audit_value_threshold.sql');
  const page = read('../src/app/pages/inventory/stock-audit/stock-audit-page.component.html');
  const policy = read('../src/app/pages/inventory/advanced-controls/advanced-controls-page.component.html');
  const policyComponent = read('../src/app/pages/inventory/advanced-controls/advanced-controls-page.component.ts');

  assert.match(service, /absolute_variance_value_paise/);
  assert.match(service, /count_value_variance_threshold_paise/);
  assert.match(migration, /expected_unit_cost_paise/);
  assert.match(page, /Absolute exposure/);
  assert.match(page, /Owner threshold/);
  assert.match(policy, /Stock-count value approval/);
  assert.match(policyComponent, /supportsCountValueVarianceThreshold/);
});

test('stock audit freezes ledger provenance and explains expected stock', () => {
  const service = read('../../backend-rust/src/services/stock_audit_service.rs');
  const repository = read('../../backend-rust/src/repositories/stock_audit_repository.rs');
  const middleware = read('../../backend-rust/src/middleware/tenant.rs');
  const migration = read('../../backend-rust/migrations/0299_stock_audit_expected_provenance.sql');
  const page = read('../src/app/pages/inventory/stock-audit/stock-audit-page.component.html');

  assert.match(repository, /ledger_stock_mismatch_count/);
  assert.match(repository, /expected_movement_summary/);
  assert.match(service, /possible_missing_inbound/);
  assert.match(service, /possible_unrecorded_consumption/);
  assert.match(migration, /expected_source_ledger_id/);
  assert.match(migration, /opening_baseline/);
  assert.match(middleware, /inventory\/stock-audits/);
  assert.match(read('../src/app/pages/inventory/stock-audit/stock-audit-page.component.ts'), /inventory\.approve/);
  assert.match(page, /Expected breakdown/);
  assert.match(page, /varianceCauseSuggestion/);
});
