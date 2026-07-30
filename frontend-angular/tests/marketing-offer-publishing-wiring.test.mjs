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
  const template = read('src/app/pages/marketing/marketing-leads-page.component.html');
  const offerDrawer = template.match(/@if \(drawer === 'offer'\)[\s\S]*?@if \(drawer === 'automation'/)?.[0] ?? '';

  for (const field of ['customer_description', 'staff_instructions', 'target_package_ids', 'show_in_staff_app', 'show_in_customer_app']) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(route, /INSERT INTO pos_coupons/);
  assert.match(route, /marketing_offer_creatives/);
  assert.match(route, /marketing\.offer\.creative_uploaded/);
  assert.match(route, /marketing\.offer\.submitted/);
  assert.match(route, /marketing\.offer\.stopped/);
  assert.match(route, /marketing\.offer\.deleted/);
  assert.match(route, /marketing\.offer\.updated/);
  assert.match(route, /redeemed offers cannot be edited/);
  assert.match(route, /redeemed or issued offers cannot be deleted/);
  assert.match(staffRoute, /show_in_staff_app=TRUE/);
  assert.match(page, /putBytes\(/);
  assert.match(page, /submitForApproval: false/);
  assert.match(page, /showInCustomerApp/);
  assert.match(page, /'\/services'/);
  assert.match(page, /'\/packages'/);
  assert.match(page, /Math\.round\(Number\(this\.offerDraft\.benefitValue\) \* 100\)/);
  assert.match(page, /\/marketing\/offers\/\$\{offer\.id\}\/stop/);
  assert.match(page, /this\.api\.delete\(`\/marketing\/offers\/\$\{offer\.id\}`\)/);
  assert.match(page, /this\.api\.patch<ApiEnvelope<MarketingOfferCreated>>/);
  assert.match(page, /editOffer\(offer: MarketingOffer\)/);
  assert.match(template, />Stop<\/button>/);
  assert.match(template, />Edit<\/button>/);
  assert.match(template, />Delete<\/button>/);
  assert.doesNotMatch(offerDrawer, /Service IDs|Package IDs|Comma separated/);
  assert.match(offerDrawer, /Applicable services<select multiple/);
  assert.match(offerDrawer, /Applicable packages<select multiple/);
  assert.match(offerDrawer, /Publishing branch/);
  assert.match(offerDrawer, /Customer \(optional\)/);
  assert.match(offerDrawer, /Public offer · all eligible customers/);
  assert.doesNotMatch(offerDrawer, /<label>Client ID<input \[\(ngModel\)\]="offerDraft\.targetClientId"/);
  assert.match(offerDrawer, /App visibility/);
});
