import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const pos = read('../../backend-rust/src/routes/pos.rs');
const posEnterprise = read('../../backend-rust/src/routes/pos_enterprise.rs');
const enterpriseService = read('../../backend-rust/src/services/pos_enterprise_service.rs');
const reseal = read('../../backend-rust/migrations/0419_reseal_draft_invoice_documents.sql');

const pdfHandler = pos.slice(
  pos.indexOf('async fn get_pos_invoice_pdf('),
  pos.indexOf('async fn read_invoice_business_profile('),
);

test('a draft PDF is rendered fresh and never sealed', () => {
  // Sealing a draft froze a half-finished bill as the invoice's permanent
  // record: every later download, including after finalize, handed back the
  // draft with the wrong totals on it.
  assert.match(pdfHandler, /if sale\.finalized_at\.is_none\(\) \{/);
  const draftBranch = pdfHandler.slice(pdfHandler.indexOf('if sale.finalized_at.is_none() {'));
  const draftBody = draftBranch.slice(0, draftBranch.indexOf('\n    }'));
  assert.doesNotMatch(draftBody, /store_invoice_pdf_snapshot|INSERT INTO pos_invoice_documents/);
  assert.match(draftBody, /invoice_pdf_response\(pdf, &sha256, &file_name\)/);
});

test('the seal happens when the invoice becomes one', () => {
  // Not whenever somebody first clicks download — that made the "permanent
  // record" a record of when a button was pressed.
  assert.match(pos, /seal_finalized_invoice_pdfs\(&state, &tenant_id, &branch_id, &id\)\.await;/);
  const finalizeTail = pos.slice(
    pos.indexOf('failed to commit invoice finalize'),
    pos.indexOf('failed to commit invoice finalize') + 700,
  );
  // After the commit: the transaction is already durable, so this cannot be
  // part of it.
  assert.match(finalizeTail, /seal_finalized_invoice_pdfs\(/);
  assert.match(pos, /for layout in \[InvoicePdfLayout::A4, InvoicePdfLayout::Thermal\]/);
});

test('a failed seal does not fail the sale', () => {
  // The finalize transaction has already committed by then, so there is
  // nothing to roll back, and refusing the response would tell the counter a
  // completed sale had failed.
  const sealer = pos.slice(
    pos.indexOf('async fn seal_finalized_invoice_pdfs('),
    pos.indexOf('async fn get_pos_invoice_pdf('),
  );
  assert.doesNotMatch(sealer, /\?;/);
  assert.match(sealer, /tracing::warn!/);
  assert.match(sealer, /deferred to first download/);
});

test('both callers build the document the same way', () => {
  // Building it twice, slightly differently, is how a sealed record stops
  // matching what the guest was handed.
  assert.match(pos, /async fn build_invoice_pdf_document\(/);
  assert.equal(pos.split('build_invoice_pdf_document(').length - 1, 3);
  assert.match(pos, /ON CONFLICT \(tenant_id, branch_id, sale_id, layout\) DO NOTHING/);
  // Exactly one place writes the snapshot, so the first-seal-wins rule cannot
  // be bypassed by a second insert somewhere else.
  assert.equal(pos.split('INSERT INTO pos_invoice_documents').length - 1, 1);
});

test('snapshots sealed under the old rule are cleared, precisely', () => {
  // Two cases, both identified rather than guessed at.
  assert.match(reseal, /AND sale\.finalized_at IS NULL;/);
  assert.match(reseal, /AND document\.created_at < sale\.finalized_at;/);
  // A genuine record — sealed at or after finalize — must survive.
  assert.doesNotMatch(reseal, /DELETE FROM pos_invoice_documents;/);
  assert.doesNotMatch(reseal, /TRUNCATE/);
});

test('an X-report writes nothing at all', () => {
  // That is the entire distinction from a Z-report. A stored X-report starts
  // looking like a fiscal document, and a second fiscal document for one day
  // is worse than none.
  const service = enterpriseService.slice(
    enterpriseService.indexOf('pub async fn x_report('),
    enterpriseService.indexOf('pub async fn eod_reconciliation('),
  );
  assert.doesNotMatch(service, /INSERT INTO|UPDATE |DELETE FROM/);
  assert.match(service, /"fiscal": false/);
  // GET only: there is nothing to POST because it produces no document.
  assert.match(posEnterprise, /\.route\("\/pos\/x-reports\/:date", get\(get_x_report\)\)/);
});

test('an X-report demands none of the Z-report preconditions', () => {
  // Needing a locked day would make it useless: the only way to find out how
  // much cash should be in the till would be to end the trading day.
  const service = enterpriseService.slice(
    enterpriseService.indexOf('pub async fn x_report('),
    enterpriseService.indexOf('pub async fn eod_reconciliation('),
  );
  assert.doesNotMatch(service, /return Err\(AppError::conflict/);
  assert.doesNotMatch(service, /ok_or_else\(/);
});

test('expected cash is reported per drawer', () => {
  // A branch total tells a cashier nothing about the till in front of them.
  const service = enterpriseService.slice(
    enterpriseService.indexOf('pub async fn x_report('),
    enterpriseService.indexOf('pub async fn eod_reconciliation('),
  );
  assert.match(service, /"expectedCashPaise": expected/);
  assert.match(service, /movement\.movement_type <> 'opening'/);
  assert.match(service, /session\.status <> 'voided'/);
});

test('voids and unpaid invoices are surfaced, not quietly excluded', () => {
  // A shift with fourteen voids in it is the thing a mid-shift read exists for.
  const service = enterpriseService.slice(
    enterpriseService.indexOf('pub async fn x_report('),
    enterpriseService.indexOf('pub async fn eod_reconciliation('),
  );
  assert.match(service, /"voided": \{ "count": voided\.0/);
  assert.match(service, /"openInvoices": \{ "count": open_invoices\.0/);
});

test('the report says why the day cannot close yet', () => {
  // So the answer arrives at four in the afternoon, not at eleven at night.
  assert.match(enterpriseService, /fn z_report_blockers\(day_locked: bool, open_drawers: i64, reconciled: bool\)/);
  assert.match(enterpriseService, /"blockers": blockers/);
  assert.match(enterpriseService, /"ready": blockers\.is_empty\(\)/);
});

test('the compliance queue is visible at branch level, not only per invoice', () => {
  // Forty invoices can fail their IRN in an afternoon — an expired provider
  // token does exactly that — and a per-invoice view only surfaces a failure if
  // somebody happens to open the one invoice it happened to.
  assert.match(pos, /\.route\("\/pos\/compliance\/queue", get\(get_compliance_queue\)\)/);
  assert.match(pos, /GROUP BY document_type,status/);
  assert.match(pos, /job\.status='failed' OR job\.attempt_count >= 5/);
  // An unconnected provider and an empty queue look identical without this.
  assert.match(pos, /"providerConfigured": state\.settings\.compliance_provider_enabled\(\)/);
});
