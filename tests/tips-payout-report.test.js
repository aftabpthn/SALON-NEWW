import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("server/services/tips.service.js", "utf8");
const routes = readFileSync("server/routes/commission.routes.js", "utf8");
const component = readFileSync("src/app/pages/pos-tips.component.ts", "utf8");
const staffSales = readFileSync("src/app/pages/staff-sales-report.component.ts", "utf8");
const financialSummary = readFileSync("src/app/pages/financial-summary-report.component.ts", "utf8");

test("tips backend exposes payout intelligence report shape", () => {
  for (const field of ["summary", "rows", "staffSummary", "alerts"]) {
    assert.match(service, new RegExp(`${field}\\s*[:,]`), `${field} should be returned by tips report`);
  }
  for (const metric of [
    "totalTips",
    "tipCount",
    "cashTips",
    "digitalTips",
    "pendingPayout",
    "paidOutTips",
    "reversedTips",
    "topTippedStaff",
    "averageTipPerInvoice",
    "tipPercentOfServiceRevenue"
  ]) {
    assert.match(service, new RegExp(metric), `${metric} should be calculated`);
  }
});

test("tips payout workflow is append-only and permissioned", () => {
  assert.match(service, /CREATE TABLE IF NOT EXISTS tip_payout_ledger/, "add-only payout ledger should be bootstrapped outside db.js");
  for (const column of ["tenantId", "branchId", "tipId", "invoiceId", "staffId", "amountPaise", "status", "payoutReference", "createdBy", "createdAt"]) {
    assert.match(service, new RegExp(column), `${column} should be persisted on payout ledger rows`);
  }
  assert.match(service, /status:\s*"paid_out"/, "payout should append paid_out status");
  assert.match(service, /status:\s*"reversed"/, "reverse should append reversed status");
  assert.doesNotMatch(service, /UPDATE\s+tip_payout_ledger/i, "ledger history should not be overwritten");

  for (const route of ["/tips/report", "/tips/staff-summary", "/tips/payout", "/tips/:id/mark-reversed", "/tips/export.csv", "/tips/payout-summary.pdf"]) {
    assert.match(routes, new RegExp(route.replace(/[/.]/g, "\\$&")), `${route} should be registered`);
  }
  assert.match(routes, /requirePermission\("write", \(\) => "finance"\)/, "payout mutations should require finance write permission");
});

test("tips report includes POS checkout tips saved on sales JSON", () => {
  assert.match(service, /saleJsonTipRows/, "report should merge POS checkout tips from sales JSON");
  assert.match(service, /membershipRedeem/, "sales membershipRedeem tips should be read as a fallback source");
  assert.match(service, /POS checkout/, "fallback rows should identify POS checkout source");
  assert.match(service, /tipDuplicateKey/, "invoice_tips and POS JSON tips should not duplicate the same tip");
});

test("tips UI includes advanced ledger, staff breakdown, alerts, payout and exports", () => {
  for (const label of [
    "Staff Tips / Tip Payout Register",
    "Tip payout alerts",
    "Invoice tip payout queue",
    "Staff payout summary",
    "No tips recorded. Add tips from POS checkout.",
    "Ledger CSV",
    "Payout PDF",
    "Mark payout",
    "Reverse",
    "Tip status",
    "Sale type",
    "Cashier / collected by",
    "Payment ID",
    "Tip-to-sale %"
  ]) {
    assert.match(component, new RegExp(label), `${label} should render on /pos/tips`);
  }
  for (const method of ["markSelectedPaidOut", "markPaidOut", "markReversed", "exportCsv", "exportPayoutPdf", "toggleTip", "toggleAll"]) {
    assert.match(component, new RegExp(`${method}\\(`), `${method} should be implemented`);
  }
  assert.match(component, /tips\/report/, "tip register should load the backend report source");
  assert.match(component, /tips\/payout/, "tip register should post payout actions");
  assert.match(component, /tip-filter-panel/, "tip filters should use the compact page-specific layout");
  assert.match(component, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, "desktop filters should render three fields per row");
  assert.match(component, /routerLink="\/staff-os\/staff-profile"/, "staff action should open Staff 360");
  assert.match(component, /routerLink="\/pos\/invoices"/, "invoice action should open POS invoices");
  assert.match(component, /routerLink="\/clients"/, "client action should open client search");
});

test("related reports link to tip register without duplicating the module", () => {
  assert.match(staffSales, /routerLink="\/pos\/tips"/, "staff sales should link to Tip Register");
  assert.match(financialSummary, /routerLink="\/pos\/tips"/, "financial summary should link to Tip Register");
});
