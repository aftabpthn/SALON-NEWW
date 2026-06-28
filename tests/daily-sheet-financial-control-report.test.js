import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/pages/financial-summary-report.component.ts", "utf8");

test("financial summary exposes Daily Sheet EOD tab and top controls", () => {
  assert.match(page, /activeTab === 'daily-sheet'/);
  assert.match(page, /Daily Sheet \/ EOD Financial Control/);
  assert.match(page, /setActiveTab\(tab: ReportTab\)/);
  assert.match(page, /setDailySheetDate/);

  for (const label of [
    "Total bills",
    "Bill average",
    "Gross sale",
    "Net sale",
    "Total received",
    "Pending / unpaid",
    "Coupon discount",
    "Membership discount",
    "GST / tax",
    "Expenses",
    "Staff tips"
  ]) {
    assert.match(page, new RegExp(label.replace(/[/.]/g, "\\$&")), `missing Daily Sheet KPI ${label}`);
  }
});

test("Daily Sheet includes item, payment, reconciliation and staff sections", () => {
  for (const label of [
    "Item details",
    "Payment mode truth",
    "Reconciliation",
    "Staff-wise daily sheet",
    "Services",
    "Products",
    "Packages",
    "Memberships",
    "Gift Cards",
    "Appointments Advance",
    "Prepaid/Wallet/Reward Payments",
    "Pending Payments",
    "Due received today",
    "Expected cash",
    "Actual cash",
    "Cash difference",
    "Deleted / void invoices",
    "High discount alerts",
    "Commission base"
  ]) {
    assert.match(page, new RegExp(label.replace(/[/.]/g, "\\$&")), `missing Daily Sheet section label ${label}`);
  }
});

test("Daily Sheet implements reusable calculations and exports", () => {
  for (const token of [
    "dailySheetSummary",
    "dailySheetItemRows",
    "dailySheetPaymentRows",
    "dailySheetReconciliationRows",
    "dailySheetStaffRows",
    "exportDailySheetCsv",
    "exportDailySheetPdf",
    "dailyCashDrawerRecord",
    "dailyHighDiscountInvoices",
    "cashDrawerReports",
    "cashDrawerSessions",
    "financeExpenses",
    "auditLogs"
  ]) {
    assert.match(page, new RegExp(token), `missing implementation token ${token}`);
  }
});
