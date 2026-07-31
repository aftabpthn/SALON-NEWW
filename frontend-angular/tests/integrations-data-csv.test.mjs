import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/pages/data-migration/csv-import.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parseCsv } = await import(`data:text/javascript,${encodeURIComponent(js)}`);

test('CSV import preserves quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('firstName,notes\r\nAftab,"Hair, Skin"\r\nSara,"She said ""yes"""'), [
    ['firstName', 'notes'],
    ['Aftab', 'Hair, Skin'],
    ['Sara', 'She said "yes"'],
  ]);
});

test('Data Migration workspace keeps the seven-stage workflow on the shared store', () => {
  const store = readFileSync('src/app/pages/data-migration/data-migration.store.ts', 'utf8');
  const page = readFileSync('src/app/pages/data-migration/integrations-data-page.component.ts', 'utf8');
  const template = readFileSync('src/app/pages/data-migration/integrations-data-page.component.html', 'utf8');

  assert.match(store, /providedIn:\s*'root'/);
  assert.match(store, /\/settings\/integrations\/import-jobs/);
  assert.match(store, /\/settings\/integrations\/import-source-files/);
  assert.match(store, /\/settings\/integrations\/import-mappings/);
  assert.match(store, /\/settings\/integrations\/import-templates/);
  assert.match(page, /inject\(DataMigrationStore\)/);
  assert.match(page, /migration\.reload\(\)/);
  assert.match(page, /migration\.loadGovernance\(job\.id\)/);
  assert.match(page, /import-mapping-suggestions/);
  assert.match(page, /sourceFileId:\s*this\.selectedSourceFileId/);
  assert.match(page, /mapping:\s*this\.selectedMappingId \? \{\} : this\.suggestedMapping/);
  assert.match(page, /mode:\s*'dry-run'/);
  assert.match(page, /migration\.loadFailureAssistant\(job\.id\)/);
  assert.match(store, /import-monitoring/);

  for (const stage of ['Source / upload', 'Mapping', 'Validation', 'Worker progress', 'Approval', 'Reconciliation', 'History / rollback']) {
    assert.match(template, new RegExp(stage.replace('/', '\\/'), 'i'));
  }
  assert.match(template, /preRollbackImpact/);
  assert.match(template, /recoveryRecommendations/);
});

test('three-layer inventory imports always send an explicit cutover contract', () => {
  const page = readFileSync('src/app/pages/data-migration/integrations-data-page.component.ts', 'utf8');
  const template = readFileSync('src/app/pages/data-migration/integrations-data-page.component.html', 'utf8');

  assert.match(page, /postingMode: this\.isThreeLayerEntity \? this\.postingMode : null/);
  assert.match(page, /cutoverId: this\.isThreeLayerEntity \? this\.cutoverId\.trim\(\) : null/);
  assert.match(page, /cutoverDate: this\.isThreeLayerEntity \? this\.cutoverDate : null/);
  assert.match(template, /value="history_only"/);
  assert.match(template, /value="opening_snapshot"/);
  assert.match(template, /value="opening_payable"/);
  assert.doesNotMatch(template, /value="live_receipt"/);
  assert.match(template, /\[disabled\]="isThreeLayerEntity/);
});

test('live GRN boundary keeps historical bills stock-neutral and owner-gates backdating', () => {
  const boundary = readFileSync('../backend-rust/migrations/0336_live_grn_boundary.sql', 'utf8');
  const purchases = readFileSync('../backend-rust/src/services/purchase_service.rs', 'utf8');
  const inventory = readFileSync('src/app/pages/inventory/inventory-page.component.ts', 'utf8');
  const template = readFileSync('src/app/pages/data-migration/integrations-data-page.component.html', 'utf8');

  assert.match(boundary, /MIGRATION_GO_LIVE_AUDIT_IMMUTABLE/);
  assert.match(boundary, /backdated_operational_approved_by/);
  assert.match(purchases, /BACKDATED_GRN_HISTORY_ONLY_REQUIRED/);
  assert.match(purchases, /BACKDATED_GRN_RECONCILIATION_REQUIRED/);
  assert.match(purchases, /historical_invoice_collision/);
  assert.match(inventory, /backdatedOperationalApproval/);
  assert.match(template, /Warning · also in live GRN/);
  assert.doesNotMatch(template, /value="live_receipt"/);
});

test('rollback recovery preserves live stock and blocks settled opening payables', () => {
  const repository = readFileSync('../backend-rust/src/repositories/migration_repository.rs', 'utf8');
  const service = readFileSync('../backend-rust/src/services/migration_service.rs', 'utf8');
  const store = readFileSync('src/app/pages/data-migration/data-migration.store.ts', 'utf8');
  const template = readFileSync('src/app/pages/data-migration/integrations-data-page.component.html', 'utf8');

  assert.match(repository, /ROLLBACK_SNAPSHOT_DEPENDENT_MOVEMENTS/);
  assert.match(repository, /ROLLBACK_OPENING_PAYABLE_SETTLED/);
  assert.match(repository, /reverse_inventory_stock_ledger/);
  assert.match(repository, /reversalJournalId/);
  assert.match(repository, /reversalLedgerId/);
  assert.match(repository, /reconciliationStatus\":\"matched/);
  assert.match(service, /safeToRollback/);
  assert.match(store, /snapshotLiveMovements/);
  assert.match(template, /Live stock movements/);
  assert.match(template, /Payable settlements/);
});

test('full reconciliation blocks unsafe go-live and exposes real cutover totals', () => {
  const migration = readFileSync('../backend-rust/migrations/0335_full_migration_reconciliation.sql', 'utf8');
  const store = readFileSync('src/app/pages/data-migration/data-migration.store.ts', 'utf8');
  const template = readFileSync('src/app/pages/data-migration/integrations-data-page.component.html', 'utf8');

  for (const blocker of [
    'UNEXPLAINED_STOCK_MISMATCH',
    'MISSING_REQUIRED_SNAPSHOT_PRODUCT',
    'BATCH_OR_LOCATION_MISMATCH',
    'OPENING_PAYABLE_MISMATCH',
    'DUPLICATE_LIVE_RECEIPT',
    'UNAPPROVED_UNIT_CONVERSION',
    'UNRESOLVED_RED_ROWS',
  ]) assert.match(migration, new RegExp(blocker));
  assert.match(migration, /NEW\.status='live'/);
  assert.match(migration, /MIGRATION_CUTOVER_RECONCILIATION_BLOCKED/);
  assert.match(migration, /integration_opening_inventory_accounting/);
  assert.match(store, /MigrationCutoverReconciliation/);
  assert.match(template, /Full reconciliation/);
});

test('opening stock is owner-approved, exact set-to, classified, and previewed', () => {
  const controls = readFileSync('../backend-rust/migrations/0342_opening_stock_phase5_controls.sql', 'utf8');
  const adapter = readFileSync('../backend-rust/src/services/migration_adapter_service.rs', 'utf8');
  const repository = readFileSync('../backend-rust/src/repositories/migration_repository.rs', 'utf8');
  const route = readFileSync('../backend-rust/src/routes/integrations.rs', 'utf8');
  const page = readFileSync('src/app/pages/data-migration/integrations-data-page.component.ts', 'utf8');
  const store = readFileSync('src/app/pages/data-migration/data-migration.store.ts', 'utf8');
  const template = readFileSync('src/app/pages/data-migration/integrations-data-page.component.html', 'utf8');

  assert.match(controls, /'inventory_frozen','snapshot_approved','live'/);
  assert.match(controls, /opening_inventory_classification_total_check/);
  assert.match(adapter, /UNIT_CONVERSION_APPROVAL_REQUIRED/);
  assert.match(adapter, /UNKNOWN_INVENTORY_LOCATION/);
  assert.match(adapter, /COUNTED_BY_USER_INVALID/);
  assert.match(adapter, /EXPIRED_BATCH_SELLABLE_BLOCKED/);
  assert.match(repository, /FOR UPDATE OF cutover/);
  assert.match(repository, /openingStockPreview/);
  assert.match(route, /MigrationCutoverStatus::SnapshotApproved/);
  assert.match(page, /nextCutoverStatus === 'snapshot_approved'/);
  assert.match(store, /openingStockPreview/);
  assert.match(template, /Opening stock exact set-to preview/);
});

test('supplier opening finance stays separate, approved, balanced, and settleable', () => {
  const controls = readFileSync('../backend-rust/migrations/0343_supplier_opening_financial_controls.sql', 'utf8');
  const signedFix = readFileSync('../backend-rust/migrations/0344_supplier_opening_signed_total_fix.sql', 'utf8');
  const adapter = readFileSync('../backend-rust/src/services/migration_adapter_service.rs', 'utf8');
  const repository = readFileSync('../backend-rust/src/repositories/migration_repository.rs', 'utf8');
  const purchases = readFileSync('../backend-rust/src/repositories/purchase_repository.rs', 'utf8');
  const routes = readFileSync('../backend-rust/src/routes/integrations.rs', 'utf8');
  const store = readFileSync('src/app/pages/data-migration/data-migration.store.ts', 'utf8');
  const template = readFileSync('src/app/pages/data-migration/integrations-data-page.component.html', 'utf8');

  assert.match(controls, /SUPPLIER_ADVANCE_ASSET/);
  assert.match(controls, /unallocated_approved/);
  assert.match(controls, /supplier_payments_single_payable_source_check/);
  assert.match(signedFix, /source_outstanding_total_pai_check/);
  assert.match(adapter, /OPENING_PAYABLE_UNALLOCATED_APPROVAL_REQUIRED/);
  assert.match(adapter, /OPENING_PAYABLE_CURRENCY_UNSUPPORTED/);
  assert.match(repository, /migration\.opening_payable\.finance_approved/);
  assert.match(repository, /OPENING_PAYABLE_APPROVAL_REQUIRED/);
  assert.match(repository, /account_code: advance_account/);
  assert.match(purchases, /'opening:'\|\|line\.id/);
  assert.match(purchases, /opening_payable_id/);
  assert.match(routes, /require_opening_payable_finance/);
  assert.match(store, /openingPayablePreview/);
  assert.match(template, /Supplier opening financial dry run/);
  assert.match(template, /Owner final approval/);
});

test('go-live is frozen, fully reconciled, owner-bound, and proof-packed', () => {
  const controls = readFileSync('../backend-rust/migrations/0345_go_live_cutover_controls.sql', 'utf8');
  const repository = readFileSync('../backend-rust/src/repositories/migration_repository.rs', 'utf8');
  const service = readFileSync('../backend-rust/src/services/migration_service.rs', 'utf8');
  const routes = readFileSync('../backend-rust/src/routes/integrations.rs', 'utf8');
  const page = readFileSync('src/app/pages/data-migration/integrations-data-page.component.ts', 'utf8');
  const template = readFileSync('src/app/pages/data-migration/integrations-data-page.component.html', 'utf8');

  for (const blocker of [
    'MISSING_HISTORICAL_BILL_EVIDENCE',
    'HISTORICAL_BILL_FINAL_STATE_INCOMPLETE',
    'HISTORICAL_TAX_TOTAL_MISMATCH',
    'WORKER_OR_CHUNK_STILL_PROCESSING',
    'OPENING_PAYABLE_JOURNAL_IMBALANCE',
    'DUPLICATE_OPENING_STOCK_MOVEMENT',
  ]) assert.match(controls, new RegExp(blocker));
  assert.match(controls, /trg_pos_sales_cutover_guard/);
  assert.match(controls, /trg_purchase_receipts_cutover_guard/);
  assert.match(controls, /trg_supplier_payments_cutover_guard/);
  assert.match(controls, /go_live_reconciliation_checksum/);
  assert.match(repository, /pub async fn cutover_proof_pack/);
  assert.match(service, /GO_LIVE_APPROVAL_NOTE_REQUIRED/);
  assert.match(service, /ROLLBACK_OBSERVATION_WINDOW_REQUIRED/);
  assert.match(routes, /migration-cutovers\/:id\/proof-pack/);
  assert.match(page, /downloadCutoverProofPack/);
  assert.match(template, /Owner approval note/);
  assert.match(template, /Download signed proof pack/);
});
