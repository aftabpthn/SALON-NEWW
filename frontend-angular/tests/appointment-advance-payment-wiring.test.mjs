import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('new booking advance is validated, accounted, and available to POS', () => {
  const backend = read('../../backend-rust/src/routes/appointments.rs');
  const cashDrawer = read('../../backend-rust/src/services/cash_drawer_service.rs');
  const accounting = read('../../backend-rust/src/services/accounting_service.rs');
  const wallet = read('../../backend-rust/src/services/wallet_service.rs');
  const pos = read('../../backend-rust/src/routes/pos.rs');
  const component = read('../src/app/pages/appointments/appointments-page.component.ts');
  const template = read('../src/app/pages/appointments/appointments-page.component.html');

  assert.match(template, /Add advance payment/);
  assert.match(component, /advance_payment: this\.collectAdvance/);
  assert.match(component, /\/settings\/payment-methods/);
  assert.match(component, /\.filter\(\(mode\) => mode\.code && mode\.active\)/);
  assert.match(backend, /INSERT INTO appointment_payment_links/);
  assert.match(backend, /post_pos_advance/);
  assert.match(backend, /settle_booking_advance/);
  assert.match(wallet, /pub async fn settle_booking_advance/);
  assert.match(cashDrawer, /record_booking_cash_advance/);
  assert.match(accounting, /"booking_advance".*"CUSTOMER_CREDIT_LIABILITY"/s);
  assert.match(pos, /link\.status='paid'/);
  assert.match(pos, /appointment_payment_allocations/);
});
