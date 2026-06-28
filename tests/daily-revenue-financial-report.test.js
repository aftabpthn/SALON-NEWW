import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/pages/financial-summary-report.component.ts", "utf8");

test("financial summary exposes Daily Revenue tab and date-wise table", () => {
  assert.match(page, /activeTab === 'daily-revenue'/);
  assert.match(page, /Daily Revenue 10x Report/);

  for (const label of [
    "Daily Revenue",
    "Total bill count",
    "Service sale",
    "Product sale",
    "Package sale",
    "Membership sale",
    "Gift card sale",
    "Wallet / prepaid used",
    "Gross sale",
    "Coupon discount",
    "Membership discount",
    "Pending / due amount",
    "Refund / return",
    "Final cash-in value"
  ]) {
    assert.match(page, new RegExp(label.replace(/[/.]/g, "\\$&")), `missing Daily Revenue label ${label}`);
  }
});

test("Daily Revenue includes KPIs, charts, drilldown and owner alerts", () => {
  for (const label of [
    "Best revenue day",
    "Lowest revenue day",
    "Average daily sale",
    "Growth vs previous period",
    "Pending due trend",
    "Discount leakage %",
    "Collection rate %",
    "Daily revenue line chart",
    "Service vs product revenue stacked chart",
    "Payment mode trend",
    "Discount vs net sale chart",
    "Pending due aging trend",
    "Us din ke invoices",
    "Staff-wise sale",
    "Service-wise sale",
    "Payment mode breakup",
    "Due/recovered invoices",
    "High discount bills",
    "Deleted/edited invoices",
    "Owner alerts",
    "Cash mismatch with drawer",
    "GST mismatch risk"
  ]) {
    assert.match(page, new RegExp(label.replace(/[/.]/g, "\\$&")), `missing Daily Revenue feature ${label}`);
  }
});

test("Daily Revenue implements calculations and exports", () => {
  for (const token of [
    "dailyRevenueRows",
    "dailyRevenueKpis",
    "dailyRevenueChart",
    "serviceProductChart",
    "paymentModeTrendChart",
    "discountVsNetChart",
    "pendingDueAgingChart",
    "dailyRevenueAlerts",
    "dailyRevenueDrilldown",
    "exportDailyRevenueCsv",
    "exportDailyRevenueOwnerPdf",
    "exportDailyRevenueAccountantPdf",
    "businessDateKey",
    "previousRevenueRange"
  ]) {
    assert.match(page, new RegExp(token), `missing Daily Revenue implementation token ${token}`);
  }
});
