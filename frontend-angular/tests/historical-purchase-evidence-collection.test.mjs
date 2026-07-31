import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Phase 1 evidence collection reuses immutable uploads and cannot post live business data', () => {
  const store = read('../src/app/pages/data-migration/data-migration.store.ts');
  const page = read('../src/app/pages/data-migration/old-purchase-bills/old-purchase-bills-page.component.ts');
  const template = read('../src/app/pages/data-migration/old-purchase-bills/old-purchase-bills-page.component.html');
  const service = read('../../backend-rust/src/services/migration_file_service.rs');
  const migration = read('../../backend-rust/migrations/0338_historical_purchase_evidence_collection.sql');

  assert.match(store, /uploadSourceFile\(file: File/);
  assert.match(page, /this\.migration\.uploadSourceFile/);
  assert.match(page, /historical-purchase-evidence\/group-decisions/);
  assert.match(page, /historical-purchase-evidence\/cutover-approval/);
  assert.match(template, /Historical bills/);
  assert.match(template, /Physical inventory count/);
  assert.match(template, /Supplier outstanding statement/);
  assert.match(service, /historicalStockEffect":0/);
  assert.match(service, /historicalAccountingEffect":0/);
  assert.match(service, /historicalGstEffect":0/);
  assert.doesNotMatch(migration, /INSERT INTO (inventory_items|inventory_stock_ledger|accounting_|supplier_payables)/i);
});
