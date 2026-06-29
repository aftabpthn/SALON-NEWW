import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("server/services/staff-sales-report.service.js", "utf8");
const routes = readFileSync("server/routes/staff-sales-report.routes.js", "utf8");
const component = readFileSync("src/app/pages/staff-sales-report.component.ts", "utf8");

test("staff sales API stays backward-compatible while exposing performance fields", () => {
  for (const legacyField of ["totals", "staff", "items"]) {
    assert.match(service, new RegExp(`${legacyField}\\s*[:},]`), `legacy ${legacyField} field should remain in report response`);
  }
  for (const analyticsField of [
    "clientsCount",
    "invoiceCount",
    "averageBill",
    "pendingDue",
    "discountGiven",
    "tips",
    "estimatedCommission",
    "performanceScore",
    "serviceBreakdown",
    "productBreakdown"
  ]) {
    assert.match(service, new RegExp(analyticsField), `${analyticsField} should be calculated by staff report service`);
  }
});

test("staff sales service supports additive filters and breakdown calculations", () => {
  for (const helper of ["matchesItemFilters", "breakdownRows", "commissionEstimate", "performanceScore", "paymentInvoiceId"]) {
    assert.match(service, new RegExp(`function ${helper}\\(`), `${helper} helper should exist`);
  }
  for (const filter of ["staffId", "saleType", "service", "product", "category", "commissionStatus", "performanceBucket", "q"]) {
    assert.match(service, new RegExp(filter), `${filter} filter should be supported`);
  }
  assert.match(service, /costSignal: "ok"/, "COGS confidence signal should be present");
  assert.match(service, /missing_cost/, "missing product consume cost should be surfaced");
});

test("staff sales route remains permissioned on the existing endpoint", () => {
  assert.match(routes, /"\/reports\/staff-sales"/, "existing staff sales endpoint should remain");
  assert.match(routes, /requirePermission\("read", \(\) => "reports"\)/, "staff sales endpoint should require report read permission");
  assert.match(routes, /staffSalesReportService\.report\(req\.query,\s*req\.access\)/, "route should pass query filters to service");
});

test("staff sales UI exposes leaderboard, exports, expandable details, and Staff 360 link", () => {
  for (const label of [
    "Total attributed sales",
    "Total clients",
    "Total invoices",
    "Average bill",
    "Pending due",
    "Discount given",
    "Staff tips",
    "Estimated commission",
    "Staff summary",
    "Line item audit"
  ]) {
    assert.match(component, new RegExp(label), `${label} should render in the staff sales report`);
  }
  for (const method of ["exportCsv", "exportOwnerPdf", "exportPayoutPdf", "toggleStaff", "isExpanded", "staffOptions"]) {
    assert.match(component, new RegExp(`${method}\\(`), `${method} should exist in staff sales component`);
  }
  assert.match(component, /serviceBreakdown/, "expanded service detail should render");
  assert.match(component, /productBreakdown/, "expanded product detail should render");
  assert.match(component, /routerLink="\/staff-os\/employee-masters"/, "Staff 360 link should point to Staff OS");
});
