import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("POS invoice register exposes final billing control strip", () => {
  const page = read("src/app/pages/pos-invoices.component.ts");

  assert.match(page, /Billing \/ POS control/);
  assert.match(page, /Payment truth/);
  assert.match(page, /Settlement/);
  assert.match(page, /GST reports/);
  assert.match(page, /Margin view/);
  assert.match(page, /Fraud flags/);
  assert.match(page, /Inventory\/profit/);
  assert.match(page, /paymentTruthScore/);
  assert.match(page, /bookingAdvanceAdjustedTotal/);
  assert.match(page, /settlementCollectedTotal/);
  assert.match(page, /gstCollectedTotal/);
  assert.match(page, /marginGrossTotal/);
  assert.match(page, /fraudFlagCount/);
  assert.match(page, /consumePendingCount/);
});

test("POS invoice register connects to live analytics, fraud and inventory sources without blocking invoice load", () => {
  const page = read("src/app/pages/pos-invoices.component.ts");

  assert.match(page, /billing-analytics\/summary/);
  assert.match(page, /billing-analytics\/margin/);
  assert.match(page, /billing-analytics\/fraud-alerts/);
  assert.match(page, /payment-intelligence\/summary/);
  assert.match(page, /inventory-intelligence\/product-consume-drafts/);
  assert.match(page, /invoice-notifications\/queue/);
  assert.match(page, /catchError\(\(\) => of\(null\)\)/);
  assert.match(page, /catchError\(\(\) => of\(\[\]\)\)/);
});

test("Billing backend exposes invoice lifecycle, GST, margin and fraud APIs", () => {
  const billingRoutes = read("server/routes/billing.routes.js");
  const invoiceLedgerRoutes = read("server/routes/invoice-ledger.routes.js");
  const gstRoutes = read("server/routes/gst.routes.js");
  const billingAnalyticsRoutes = read("server/routes/billing-analytics.routes.js");
  const fraudRoutes = read("server/routes/payment-fraud-intelligence.routes.js");
  const trueMarginService = read("server/services/true-margin.service.js");

  assert.match(billingRoutes, /\/billing\/invoices\/:id\/finalize/);
  assert.match(billingRoutes, /requireIdempotencyKey/);
  assert.match(invoiceLedgerRoutes, /\/invoice-ledger\/:invoiceId\/events/);
  assert.match(invoiceLedgerRoutes, /\/invoice-ledger\/:invoiceId\/verify/);
  assert.match(gstRoutes, /\/gst\/gstr1/);
  assert.match(gstRoutes, /\/gst\/gstr3b/);
  assert.match(gstRoutes, /\/gst\/hsn-summary/);
  assert.match(billingAnalyticsRoutes, /\/billing-analytics\/margin/);
  assert.match(billingAnalyticsRoutes, /\/billing-analytics\/fraud-alerts/);
  assert.match(fraudRoutes, /\/payment-intelligence\/summary/);
  assert.match(trueMarginService, /invoice_item_margins/);
  assert.match(trueMarginService, /gross_margin/);
});

test("Final POS links open the right operational workspaces", () => {
  const page = read("src/app/pages/pos-invoices.component.ts");

  assert.match(page, /routerLink="\/pos\/invoice-activity"/);
  assert.match(page, /routerLink="\/reports\/invoices"/);
  assert.match(page, /routerLink="\/inventory\/financial"/);
  assert.match(page, /routerLink="\/command-center\/payment-intelligence"/);
  assert.match(page, /routerLink="\/inventory\/product-consume"/);
});
