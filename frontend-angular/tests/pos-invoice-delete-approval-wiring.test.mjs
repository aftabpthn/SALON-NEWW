import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(
  new URL('../src/app/pages/pos/invoices/pos-invoices-page.component.ts', import.meta.url),
  'utf8',
);
const template = readFileSync(
  new URL('../src/app/pages/pos/invoices/pos-invoices-page.component.html', import.meta.url),
  'utf8',
);
const backend = readFileSync(
  new URL('../../backend-rust/src/routes/pos.rs', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../backend-rust/migrations/0229_pos_invoice_delete_approvals.sql', import.meta.url),
  'utf8',
);

test('invoice deletion is approval-gated and direct deletion is blocked', () => {
  assert.match(backend, /\/pos\/invoices\/:id\/delete-request/);
  assert.match(backend, /\/pos\/invoice-delete-requests\/:request_id\/decision/);
  assert.match(backend, /requester cannot approve or reject their own invoice delete request/);
  assert.match(backend, /direct invoice deletion is blocked/);
  assert.match(backend, /is_deleted=TRUE/);
});

test('delete approval storage is tenant-scoped, auditable, and preserves the invoice', () => {
  assert.match(migration, /sale_id TEXT NOT NULL REFERENCES pos_sales\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /requested_by_user_id TEXT NOT NULL/);
  assert.match(migration, /pos_invoice_delete_request_separation_of_duties/);
  assert.match(migration, /WHERE status = 'pending'/);
});

test('existing invoice detail exposes request and manager decision controls', () => {
  assert.match(component, /submitDeleteRequest\(\)/);
  assert.match(component, /decideDeleteRequest\(status: 'approved' \| 'rejected'\)/);
  assert.match(component, /hasPermission\('pos\.void'\)/);
  assert.match(template, />Request delete</);
  assert.match(template, />Approve soft-delete</);
  assert.match(template, /Delete approval pending/);
});
