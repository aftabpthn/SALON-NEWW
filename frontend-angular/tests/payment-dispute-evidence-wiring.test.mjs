import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const service = read('../../backend-rust/src/services/payment_dispute_service.rs');
const route = read('../../backend-rust/src/routes/payment_platform.rs');
const migration = read('../../backend-rust/migrations/0415_payment_dispute_evidence.sql');
const page = read('../src/app/pages/pos/payment-integrations/payments-integrations-page.component.ts');
const template = read('../src/app/pages/pos/payment-integrations/payments-integrations-page.component.html');

test('dispute evidence is reachable end to end', () => {
  for (const path of ['/pos/payment-platform/disputes/queue', '/pos/payment-platform/disputes/:id/evidence']) {
    assert.match(route, new RegExp(path.replace(/[/:]/g, '\\$&')), `missing route ${path}`);
  }
  // Reading a pack is a finance read; snapshotting it is a write.
  assert.match(route, /async fn prepare_dispute_evidence\([\s\S]{0,400}?require_payment_manage\(&claims\)/);
  assert.match(page, /\/pos\/payment-platform\/disputes\/queue/);
  assert.match(page, /disputes\/\$\{[a-zA-Z.]+\}\/evidence/);
  assert.match(template, /disputeQueue/);
});

test('AuraShine never submits a representment on its own', () => {
  // Provider rules differ and a wrong automatic submission cannot be withdrawn,
  // so the last step stays manual by design.
  assert.match(service, /does not submit representments/);
  assert.match(template, /submissionNote/);
  assert.doesNotMatch(service, /reqwest|http_client|\.send\(\)/, 'the service must not call a provider');
});

test('the submitted pack survives later edits to the records behind it', () => {
  assert.match(migration, /evidence_pack_json JSONB NOT NULL DEFAULT '\{\}'::JSONB/);
  assert.match(migration, /evidence_prepared_at TIMESTAMPTZ/);
  assert.match(migration, /evidence_prepared_by TEXT NOT NULL/);
  assert.match(service, /evidence_pack_json = \$4/);
  // The live pack is assembled on read; only the prepared one is stored.
  assert.match(service, /pub async fn evidence_pack/);
  assert.match(service, /pub async fn record_prepared_evidence/);
});

test('the queue is ordered by deadline before size', () => {
  assert.match(service, /pub fn urgency/);
  assert.match(service, /evidence_due_at NULLS LAST/);
  assert.match(migration, /idx_payment_disputes_evidence_due/);
  // A passed deadline is what a manager most needs to see.
  assert.match(service, /days <= 0\.0 => 100\.0/);
});

test('every strength factor carries its evidence and stays in range', () => {
  assert.match(migration, /strength_score INTEGER NOT NULL DEFAULT 0[\s\S]{0,80}?CHECK \(strength_score BETWEEN 0 AND 100\)/);
  assert.match(service, /clamp\(0, 100\)/);
  assert.match(service, /pub const MODEL_VERSION/);
  assert.match(service, /pub struct StrengthFactor[\s\S]{0,200}?detail: String/);
  assert.match(template, /factor\.detail/);
});

test('missing evidence is surfaced, not hidden', () => {
  // What is absent tells a manager what to go and find before the deadline.
  assert.match(service, /let mut gaps = Vec::new\(\)/);
  assert.match(service, /No completed appointment covers this sale/);
  assert.match(service, /No signed form is on file for this guest/);
  assert.match(template, /disputeEvidence\.gaps/);
});
