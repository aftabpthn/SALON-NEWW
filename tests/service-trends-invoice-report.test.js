import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("server/app.js", "utf8");
const route = readFileSync("server/routes/service-trends-report.routes.js", "utf8");
const service = readFileSync("server/services/service-trends-report.service.js", "utf8");
const invoiceReports = readFileSync("src/app/pages/invoice-reports.component.ts", "utf8");
const reports = readFileSync("src/app/pages/reports.component.ts", "utf8");

test("service trends report API is mounted and permissioned", () => {
  assert.match(app, /serviceTrendsReportRouter/, "app should import and mount service trends router");
  assert.match(app, /app\.use\("\/api\/v1",\s*serviceTrendsReportRouter\)/, "v1 API should expose service trends report");
  assert.match(app, /app\.use\("\/api",\s*serviceTrendsReportRouter\)/, "legacy API should expose service trends report");
  assert.match(route, /\.get\("\/reports\/invoices\/service-trends"/, "route should expose service trends GET endpoint");
  assert.match(route, /requirePermission\("read",\s*\(\) => "reports"\)/, "service trends should require reports read permission");
});

test("service trends service returns summary and row intelligence", () => {
  for (const token of [
    "totalServicesSold",
    "totalServiceRevenue",
    "averageServicePrice",
    "topServiceGroup",
    "highestMarginService",
    "lowestMarginService",
    "peakSellingHour",
    "discountLeakage",
    "serviceGstCollected",
    "product_consume_drafts",
    "Cost missing"
  ]) {
    assert.match(service, new RegExp(token), `missing service trends service token: ${token}`);
  }
});

test("invoice reports page exposes service trends tab, filters and table", () => {
  assert.match(invoiceReports, /id:\s*'service-trends'/, "invoice reports should include Service Trends tab");
  assert.match(invoiceReports, /loadServiceTrendsReport/, "UI should load service trends API");
  assert.match(invoiceReports, /reports\/invoices\/service-trends/, "UI should call service trends endpoint");
  assert.match(invoiceReports, /ActivatedRoute/, "UI should support report query param");

  for (const label of [
    "Total services sold",
    "Total service revenue",
    "Average service price",
    "Service group/category",
    "Product cost / COGS",
    "Repeat client count",
    "Peak hour",
    "View invoices",
    "Service master"
  ]) {
    assert.match(invoiceReports, new RegExp(label.replace(/[/%]/g, "\\$&")), `missing service trends UI label: ${label}`);
  }
});

test("reports command center links directly to service trends", () => {
  assert.match(reports, /Service Trends/, "reports command center should include Service Trends quick link");
  assert.match(reports, /report:\s*'service-trends'/, "Service Trends quick link should open the correct invoice report tab");
});
