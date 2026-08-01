import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Phase 1 evidence collection reuses immutable uploads and cannot post live business data', () => {
  const store = read('../src/app/pages/data-migration/data-migration.store.ts');
  const page = read('../src/app/pages/data-migration/old-purchase-bills/old-purchase-bills-page.component.ts');
  const template = read('../src/app/pages/data-migration/old-purchase-bills/old-purchase-bills-page.component.html');
  const service = read('../../backend-rust/src/services/migration_file_service.rs');
  const routes = read('../../backend-rust/src/routes/integrations.rs');
  const migration = read('../../backend-rust/migrations/0338_historical_purchase_evidence_collection.sql');
  const correctionMigration = read('../../backend-rust/migrations/0352_historical_evidence_corrections.sql');

  assert.match(store, /uploadSourceFile\(file: File/);
  assert.match(page, /this\.migration\.uploadSourceFile/);
  assert.match(page, /historical-purchase-evidence\/group-decisions/);
  assert.match(page, /historical-purchase-evidence\/cutover-approval/);
  assert.match(template, /Historical bills/);
  assert.match(template, /Physical inventory count/);
  assert.match(template, /Supplier outstanding statement/);
  assert.match(template, /Correct supplier batch/);
  assert.match(template, /Exclude wrong upload/);
  assert.match(template, /Restore evidence/);
  assert.match(routes, /historical-purchase-evidence\/:source_file_id\/corrections/);
  assert.match(service, /correct_historical_evidence/);
  assert.match(correctionMigration, /historical_purchase_evidence_corrections/);
  assert.match(correctionMigration, /HISTORICAL_PURCHASE_EVIDENCE_EXCLUDED/);
  assert.match(correctionMigration, /BEFORE UPDATE OR DELETE ON historical_purchase_evidence_corrections/);
  assert.match(service, /historicalStockEffect":0/);
  assert.match(service, /historicalAccountingEffect":0/);
  assert.match(service, /historicalGstEffect":0/);
  assert.doesNotMatch(migration, /INSERT INTO (inventory_items|inventory_stock_ledger|accounting_|supplier_payables)/i);
  assert.doesNotMatch(correctionMigration, /INSERT INTO (inventory_items|inventory_stock_ledger|accounting_|supplier_payables)/i);
});
