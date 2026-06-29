import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("server/services/staff-payroll-history-report.service.js", "utf8");
const routes = readFileSync("server/routes/staff-payroll.routes.js", "utf8");
const page = readFileSync("src/app/features/staff-os/pages/payroll-history.page.ts", "utf8");
const staffRoutes = readFileSync("src/app/features/staff-os/staff-os.routes.ts", "utf8");
const staffSection = readFileSync("src/app/features/staff-os/ui/staff-os-section.component.ts", "utf8");
const appShell = readFileSync("src/app/app.component.ts", "utf8");
const reports = readFileSync("src/app/pages/reports.component.ts", "utf8");

test("payroll history report backend exposes staff-wise payroll ledger", () => {
  assert.match(service, /staff_payroll_runs/, "report should read payroll runs");
  assert.match(service, /staff_payroll_items/, "report should read payroll items");
  assert.match(service, /staff_master/, "report should enrich rows with staff master data");
  assert.match(service, /requirePayrollAccess/, "report should enforce payroll access");
  assert.match(service, /tenantService\.assertBranchAccess/, "branch access should be checked");
  for (const field of [
    "payrollRunId",
    "payrollItemId",
    "periodStart",
    "periodEnd",
    "grossAmount",
    "deductionAmount",
    "netAmount",
    "pf",
    "esic",
    "tds",
    "professionalTax",
    "paymentMode",
    "paidAt"
  ]) {
    assert.match(service, new RegExp(field), `${field} should be returned in payroll history rows`);
  }
});

test("payroll history route is additive under existing staff payroll router", () => {
  assert.match(routes, /staffPayrollHistoryReportService/, "payroll history service should be imported");
  assert.match(routes, /"\/staff-os\/payroll\/history-report"/, "payroll history API route should exist");
  assert.match(routes, /staffPayrollService\.listPayroll/, "existing payroll list route should remain");
});

test("payroll history UI renders report controls, exports, and row actions", () => {
  for (const label of [
    "Payroll History",
    "Gross payroll",
    "Deductions",
    "Net salary",
    "Paid amount",
    "Pending payout",
    "Payroll ledger",
    "Run and staff-wise salary history",
    "Owner PDF",
    "CSV"
  ]) {
    assert.match(page, new RegExp(label), `${label} should render on payroll history page`);
  }
  assert.match(page, /staff-os\/payroll\/history-report/, "page should call payroll history API");
  assert.match(page, /exportCsv\(\)/, "CSV export should be available");
  assert.match(page, /exportOwnerPdf\(\)/, "owner PDF export should be available");
  assert.match(page, /routerLink="\/staff-os\/staff-profile"/, "staff action should open staff profile");
  assert.match(page, /routerLink="\/staff-os\/salary-generate"/, "run action should open salary generate");
});

test("payroll history is discoverable from Staff OS and reports command center", () => {
  assert.match(staffRoutes, /payroll-history/, "staff-os route should include payroll history");
  assert.match(staffSection, /routerLink="\/staff-os\/payroll-history"/, "payroll dashboard should link to payroll history");
  assert.match(appShell, /Payroll History/, "app command search should include Payroll History");
  assert.match(reports, /Payroll History/, "reports command center should include Payroll History quick link");
});
