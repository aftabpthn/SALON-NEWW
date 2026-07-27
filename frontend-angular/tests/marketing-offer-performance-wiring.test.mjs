import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("offer performance uses persisted events, bookings and finalized POS sales", () => {
  const route = read("../../backend-rust/src/routes/marketing_leads.rs");
  const migration = read("../../backend-rust/migrations/0276_marketing_offer_performance.sql");
  assert.match(migration, /marketing_offer_events/);
  assert.match(route, /marketing\/offers\/performance/);
  assert.match(route, /appointment\.source LIKE 'marketing_offer:'/);
  assert.match(route, /sale\.coupon_discount_paise/);
  assert.match(route, /sale\.finalized_at IS NOT NULL/);
  assert.match(route, /WHEN offer\.ends_at<NOW\(\) THEN 'expired'/);
});

test("staff and customer app activity is tracked in the existing Offers tab", () => {
  const staffRoute = read("../../backend-rust/src/routes/staff_enterprise.rs");
  const customerRoute = read("../../backend-rust/src/routes/customer_portal.rs");
  const customerOffers = read("../../customer-app/src/app/features/offers/offers.page.ts");
  const crm = read("../src/app/pages/marketing/marketing-leads-page.component.html");
  assert.match(staffRoute, /'view','staff_app'/);
  assert.match(customerRoute, /'view','customer_app'/);
  assert.match(customerRoute, /'click',\$2/);
  assert.match(customerRoute, /ends_at IS NULL OR offer\.ends_at>=NOW\(\)/);
  assert.match(customerOffers, /marketing_offer:\$\{offer\.id\}:customer_app/);
  assert.match(crm, /Offer performance/);
  assert.match(crm, /Revenue after discount/);
});
