import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Phase 4 reuses versioned historical mapping APIs with governed reloads', () => {
  const routes = read('backend-rust/src/routes/integrations.rs');
  const service = read('backend-rust/src/services/migration_service.rs');
  const repository = read('backend-rust/src/repositories/migration_repository.rs');
  const page = read('frontend-angular/src/app/pages/data-migration/old-purchase-bills/old-purchase-bills-page.component.ts');
  const template = read('frontend-angular/src/app/pages/data-migration/old-purchase-bills/old-purchase-bills-page.component.html');

  assert.match(routes, /historical-purchase-mapping-report/);
  assert.match(routes, /require_historical_catalog_create/);
  assert.match(service, /HISTORICAL_MAPPING_BULK_GREEN_REQUIRED/);
  assert.match(service, /size, shade and color conflicts cannot be overridden/);
  assert.match(repository, /historical_purchase_identity_mapping_versions/);
  assert.match(repository, /historical_mapping_material_snapshot/);
  assert.match(repository, /convertedQuantityNumerator/);
  assert.match(repository, /"suggestedCandidates":suggested_candidates/);
  assert.match(repository, /"selectedTarget":selected_target_snapshot/);
  assert.match(repository, /HISTORICAL_MAPPING_VARIANT_CONFLICT/);
  assert.match(page, /bulkApproval: true/);
  assert.match(page, /await this\.reload\(\)/);
  assert.match(template, /Approve selected Green/);
  assert.match(template, /Create and map/);
  assert.match(template, /Mapping versions/);
  assert.doesNotMatch(page, /approveVariantMismatch:\s*Boolean/);
});

test('Phase 4 decision transaction has zero operational posting paths', () => {
  const repository = read('backend-rust/src/repositories/migration_repository.rs');
  const start = repository.indexOf('pub async fn decide_historical_purchase_mapping');
  const end = repository.indexOf('pub async fn rollback_historical_purchase_mapping', start);
  const decision = repository.slice(start, end);

  for (const table of [
    'inventory_stock_ledger',
    'purchase_receipts',
    'accounting_journal_entries',
    'accounting_journal_lines',
    'supplier_opening_payables',
  ]) {
    assert.doesNotMatch(decision, new RegExp(`INSERT\\s+INTO\\s+${table}`, 'i'));
  }
  assert.match(decision, /"stockEffect":"none"/);
  assert.match(decision, /"gstEffect":"none"/);
  assert.match(decision, /"payableEffect":"none"/);
});
