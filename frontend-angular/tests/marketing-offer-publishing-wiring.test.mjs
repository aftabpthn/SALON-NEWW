import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('marketing offers keep one POS-backed publishing contract', () => {
  const migration = read('../backend-rust/migrations/0275_marketing_offer_publishing.sql');
  const route = read('../backend-rust/src/routes/marketing_leads.rs');
  const staffRoute = read('../backend-rust/src/routes/staff_enterprise.rs');
  const page = read('src/app/pages/marketing/marketing-leads-page.component.ts');

  for (const field of ['customer_description', 'staff_instructions', 'target_package_ids', 'show_in_staff_app', 'show_in_customer_app']) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(route, /INSERT INTO pos_coupons/);
  assert.match(route, /marketing_offer_creatives/);
  assert.match(route, /marketing\.offer\.creative_uploaded/);
  assert.match(route, /marketing\.offer\.submitted/);
  assert.match(staffRoute, /show_in_staff_app=TRUE/);
  assert.match(page, /putBytes\(/);
  assert.match(page, /submitForApproval: false/);
  assert.match(page, /showInCustomerApp/);
});
