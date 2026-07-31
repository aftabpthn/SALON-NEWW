import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../src/app/pages/data-migration/old-purchase-bills/', import.meta.url);
const component = readFileSync(new URL('old-purchase-bills-page.component.ts', root), 'utf8');
const template = readFileSync(new URL('old-purchase-bills-page.component.html', root), 'utf8');
const routes = readFileSync(
  new URL('../../backend-rust/src/routes/integrations.rs', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../backend-rust/migrations/0341_historical_purchase_bulk_archive.sql', import.meta.url),
  'utf8',
);

test('bulk archive uses real scoped APIs and targeted reloads', () => {
  assert.match(component, /historical-purchase-bulk\?cutoverId=/);
  assert.match(component, /historical-purchase-bulk\/\$\{batch\.jobId\}\/archive/);
  assert.match(component, /import-jobs\/\$\{batch\.jobId\}\/\$\{action\}/);
  assert.match(component, /await this\.reloadBulk\(\)/);
  assert.match(template, /Bulk Archive/);
  assert.match(template, /Stock \/ GL \/ GST \/ payable/);
});

test('backend and database keep bulk posting history-only and durable', () => {
  assert.match(routes, /historical-purchase-bulk/);
  assert.match(migration, /posting_mode='history_only'/);
  assert.match(migration, /lease_expires_at TIMESTAMPTZ/);
  assert.match(migration, /status IN \(\s*'uploaded','profiling','extracting','review_required','ready','archived'/);
  assert.doesNotMatch(migration, /INSERT INTO (inventory_stock_ledger|accounting_journal|purchase_receipts)/i);
});
