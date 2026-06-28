import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const invoiceReports = readFileSync("src/app/pages/invoice-reports.component.ts", "utf8");
const reportsCenter = readFileSync("src/app/pages/reports.component.ts", "utf8");

test("invoice reports expose Sale Summary as the default bill-level report", () => {
  assert.match(invoiceReports, /readonly activeReport = signal\('sale-summary'\)/);
  assert.match(invoiceReports, /title: 'Sale Summary'/);
  assert.match(invoiceReports, /badge: '00'/);
  assert.match(invoiceReports, /21 connected reports/);
  assert.match(invoiceReports, /Sale list with bill, client, payment, prepaid, coupon, loyalty and GST details/);
});

test("Sale Summary has Salonist-style KPIs and bill table columns", () => {
  for (const label of [
    "Total Bill",
    "Bill Average",
    "Total Sale",
    "Received Amount",
    "Pending Amount",
    "Prepaid Payment",
    "Return Sales",
    "Total Tip Amount",
    "Total Tax",
    "Invoice No",
    "Name",
    "Contact",
    "Item Description",
    "Item Types",
    "Actual Price",
    "Coupon Code",
    "Coupon Discount",
    "Loyalty Discount"
  ]) {
    assert.match(invoiceReports, new RegExp(label.replace(/[/?]/g, "\\$&")), `missing Sale Summary label: ${label}`);
  }

  assert.match(invoiceReports, /saleSummaryRows\(\)/);
  assert.match(invoiceReports, /saleSummary\(\): SaleSummary/);
  assert.match(invoiceReports, /Invoice, name or phone/);
  assert.match(invoiceReports, /prepaidAmount\(invoice: ApiRecord, sale: ApiRecord, payments: ApiRecord\[\]\)/);
});

test("reports command center links directly to Sale Summary", () => {
  assert.match(reportsCenter, /label: 'Sale Summary'/);
  assert.match(reportsCenter, /module: 'Sale list with bill'/);
  assert.match(reportsCenter, /path: '\/reports\/invoices'/);
});
