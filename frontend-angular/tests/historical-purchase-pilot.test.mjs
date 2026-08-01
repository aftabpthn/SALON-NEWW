import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('historical pilot reuses evidence drafts and cannot post live effects', () => {
  const migration = read('../../backend-rust/migrations/0340_historical_purchase_pilot.sql');
  const service = read('../../backend-rust/src/services/purchase_bill_drafts_service.rs');
  const routes = read('../../backend-rust/src/routes/integrations.rs');
  const page = read('../src/app/pages/data-migration/old-purchase-bills/old-purchase-bills-page.component.ts');
  const pilotTemplate = read('../src/app/pages/data-migration/old-purchase-bills/old-purchase-bills-page.component.html');
  const review = read('../src/app/pages/inventory/purchase-bill-drafts/purchase-bill-drafts-page.component.ts');
  const template = read('../src/app/pages/inventory/purchase-bill-drafts/purchase-bill-drafts-page.component.html');

  assert.match(service, /historical pilot requires 20 to 50 evidence documents/);
  assert.match(service, /excluded or rejected evidence cannot be selected for the pilot/);
  assert.match(service, /workflow_mode == "historical_pilot"/);
  assert.match(service, /historical pilot review cannot post a GRN, stock, accounting, GST, or payable entry/);
  assert.match(service, /"stockEffectPaise":0/);
  assert.match(service, /"accountingEffectPaise":0/);
  assert.match(service, /"gstEffectPaise":0/);
  assert.match(service, /pilot_grouping_suggestions/);
  assert.match(service, /carry_forward_total/);
  assert.match(service, /Red pilot grouping cannot be approved/);
  assert.match(service, /"financial":financial_accuracy\.json\(10_000\)/);
  assert.match(migration, /HISTORICAL_PURCHASE_PILOT_CANNOT_POST_GRN/);
  assert.doesNotMatch(migration, /INSERT INTO (inventory_stock_ledger|accounting_|supplier_payables)/i);
  assert.match(routes, /historical-purchase-pilot/);
  assert.match(routes, /historical-purchase-pilot\/group-decisions/);
  assert.match(page, /this\.pilotSelection\.size < 20 \|\| this\.pilotSelection\.size > 50/);
  assert.match(pilotTemplate, /Financial accuracy/);
  assert.match(pilotTemplate, /Product-line detection/);
  assert.match(pilotTemplate, /Content-based page grouping/);
  assert.doesNotMatch(pilotTemplate, />Phase [123]</);
  assert.match(review, /workflowMode: 'live_receipt' \| 'historical_pilot'/);
  assert.match(review, /correctionReason: this\.reviewReason/);
  assert.match(template, /Approve history/);
  assert.match(template, /zero live effects/);
});
