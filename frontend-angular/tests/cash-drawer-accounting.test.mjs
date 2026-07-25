import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('cash refunds and confirmed deposits post idempotent drawer accounting', () => {
  const migration = read('../backend-rust/migrations/0236_cash_refund_accounting.sql');
  const pos = read('../backend-rust/src/routes/pos.rs');
  const drawer = read('../backend-rust/src/services/cash_drawer_service.rs');
  const repository = read('../backend-rust/src/repositories/cash_drawer_repository.rs');
  const accounting = read('../backend-rust/src/services/accounting_service.rs');
  const component = read('src/app/pages/pos/invoices/pos-invoices-page.component.ts');

  assert.match(migration, /pos_refund_payment_allocations/);
  assert.match(migration, /uq_cash_drawer_invoice_refund_movement/);
  assert.match(pos, /record_invoice_cash_refund/);
  assert.match(pos, /idempotencyKey is required for refunds/);
  assert.match(accounting, /cash_drawer_bank_deposit/);
  assert.match(accounting, /account_code: "CASH_ON_HAND"/);
  assert.match(drawer, /post_cash_bank_deposit/);
  assert.match(repository, /invoice_refund_accounting_variance/);
  assert.match(component, /cashDrawerTillId: this\.refundMethod === 'cash'/);
});
