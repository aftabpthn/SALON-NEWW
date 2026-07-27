import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/pages/pos/tips/pos-tips-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/pos/tips/pos-tips-page.component.html', 'utf8');
const staffRoutes = readFileSync('../backend-rust/src/routes/staff_enterprise.rs', 'utf8');
const staffRepo = readFileSync('../backend-rust/src/repositories/staff_enterprise_repository.rs', 'utf8');

test('tip register uses existing APIs for invoice tips and payout status', () => {
  assert.match(page, /\/api\/v1\/pos\/sales-register\?page=1&pageSize=100/);
  assert.match(page, /\/api\/v1\/staff\/tips\?periodStart=1970-01-01&periodEnd=2999-12-31/);
  assert.match(staffRoutes, /\.route\("\/staff\/tips", get\(list_tips\)\)/);
  assert.match(staffRepo, /pi\.payout_id/);
});

test('tip register derives payment modes from sales-register payment split', () => {
  assert.match(page, /paymentSplit\(row: any\)/);
  assert.match(page, /\['UPI', this\.firstMoney\(row, \['upiPaise', 'upi_paise'\]\)\]/);
  assert.match(page, /\|\| split\.label \|\| 'Unspecified'/);
  assert.match(page, /allocateTip/);
  assert.match(template, /Payment split/);
});

test('tip register exposes payout filter and invoice navigation', () => {
  assert.match(page, /payoutStatus = ''/);
  assert.match(template, /All payout status/);
  assert.match(template, /Paid out/);
  assert.match(template, /routerLink="\/pos\/invoices"/);
  assert.match(template, /queryParams]="\{ invoiceId: selected\.id, view: 'full' \}"/);
});
