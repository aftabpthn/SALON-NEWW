import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const financialSummary = readFileSync("src/app/pages/financial-summary-report.component.ts", "utf8");
const appRoutes = readFileSync("src/app/app.routes.ts", "utf8");
const reportsCenter = readFileSync("src/app/pages/reports.component.ts", "utf8");

test("financial summary report is routed from the reports workspace", () => {
  assert.match(appRoutes, /reports\/financial-summary/);
  assert.match(appRoutes, /FinancialSummaryReportComponent/);
  assert.match(reportsCenter, /routerLink="\/reports\/financial-summary"/);
  assert.match(reportsCenter, /label: 'Financial Summary'/);
  assert.match(reportsCenter, /module: 'Owner accounting'/);
});

test("financial summary exposes owner accounting controls and KPIs", () => {
  for (const label of [
    "Financial Summary",
    "Total Sales",
    "Paid",
    "Balance",
    "Taxes",
    "Expenses",
    "Net Cashflow",
    "Month",
    "Quarter",
    "Export",
    "Print"
  ]) {
    assert.match(financialSummary, new RegExp(label), `missing label: ${label}`);
  }
});

test("financial summary matrix includes Salonist-style financial rows", () => {
  for (const label of [
    "Discounts",
    "Coupon Discounts",
    "Taxes",
    "Ex Charges",
    "Gift Cards Sale",
    "Expenses",
    "Appointments Advance",
    "Tips",
    "CARD",
    "CASH",
    "UPI",
    "Reward"
  ]) {
    assert.match(financialSummary, new RegExp(label), `missing matrix row: ${label}`);
  }

  assert.match(financialSummary, /finance\/summary/);
  assert.match(financialSummary, /walletTransactions/);
  assert.match(financialSummary, /matrixRows\(\): MatrixCell\[\]/);
});
