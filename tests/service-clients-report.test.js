import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("server/routes/service-trends-report.routes.js", "utf8");
const service = readFileSync("server/services/service-trends-report.service.js", "utf8");
const invoiceReports = readFileSync("src/app/pages/invoice-reports.component.ts", "utf8");
const reports = readFileSync("src/app/pages/reports.component.ts", "utf8");
const literal = (value) => new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test("service clients API is exposed through service trends report router", () => {
  assert.match(route, /\.get\("\/reports\/invoices\/service-clients"/, "route should expose service clients endpoint");
  assert.match(route, /serviceTrendsReportService\.serviceClients/, "route should call service clients report method");
  assert.match(route, /requirePermission\("read",\s*\(\) => "reports"\)/, "route should require report read permission");
});

test("service clients backend returns row-level client service fields", () => {
  for (const token of [
    "serviceClients(query",
    "totalClients",
    "totalServiceRevenue",
    "totalServiceRows",
    "appointmentRows",
    "quickSaleRows",
    "clientPhone",
    "servicePrice",
    "saleType",
    "Appointment",
    "Quick Sale",
    "serviceClientMatches"
  ]) {
    assert.match(service, literal(token), `missing service clients backend token: ${token}`);
  }
});

test("invoice reports UI exposes service clients tab, filters, columns and actions", () => {
  for (const token of [
    "id: 'service-clients'",
    "reports/invoices/service-clients",
    "serviceClientsSummary",
    "serviceClientsReportRows",
    "serviceSaleTypeFilter",
    "Total clients",
    "Service Clients",
    "Groups",
    "Service Name",
    "Contact",
    "Service Price",
    "Sale Type",
    "Open Client 360",
    "Open Invoice"
  ]) {
    assert.match(invoiceReports, literal(token), `missing service clients UI token: ${token}`);
  }
});

test("reports command center links directly to service clients", () => {
  assert.match(reports, /Service Clients/, "reports command center should include Service Clients quick link");
  assert.match(reports, /report:\s*'service-clients'/, "quick link should open service clients invoice report tab");
});
