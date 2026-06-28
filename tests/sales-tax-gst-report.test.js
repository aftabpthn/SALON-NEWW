import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/pages/financial-summary-report.component.ts", "utf8");

test("financial summary exposes Sales Tax / GST tab and summary cards", () => {
  assert.match(page, /activeTab === 'sales-tax'/);
  assert.match(page, /Sales Tax \/ GST 10x Report/);

  for (const label of [
    "Total bills",
    "Gross sale",
    "Net sale",
    "Taxable amount",
    "Total GST",
    "CGST",
    "SGST",
    "IGST",
    "Coupon discount",
    "Membership discount",
    "Tax-exempt sale",
    "GST mismatch count"
  ]) {
    assert.match(page, new RegExp(label.replace(/[/.]/g, "\\$&")), `missing GST summary label ${label}`);
  }
});

test("sales tax report includes register, breakup and accounting checks", () => {
  for (const label of [
    "Invoice-wise tax register",
    "Invoice no",
    "Client",
    "Phone",
    "GSTIN",
    "Staff / cashier",
    "Actual price",
    "Discount",
    "Taxable amount",
    "GST %",
    "Payment mode",
    "Tax status",
    "GST rate breakup",
    "0%, 5%, 12%, 18%, 28%",
    "Service/product tax split",
    "Accounting checks",
    "Deleted/void excluded"
  ]) {
    assert.match(page, new RegExp(label.replace(/[/.]/g, "\\$&")), `missing GST report label ${label}`);
  }
});

test("sales tax report implements calculations, caching and exports", () => {
  for (const token of [
    "salesTaxRows",
    "salesTaxSummary",
    "gstRateBreakupRows",
    "salesTaxTypeSplitRows",
    "salesTaxAccountingChecks",
    "exportSalesTaxCsv",
    "exportSalesTaxOwnerPdf",
    "exportSalesTaxAccountantPdf",
    "ensureSalesTaxClientDataLoaded",
    "salesTaxRowsCache",
    "salesTaxSummaryCache",
    "invoiceTaxableAmount",
    "invoiceGstRate",
    "invoiceTaxStatus",
    "isDeletedVoidInvoice"
  ]) {
    assert.match(page, new RegExp(token.replace(/[()]/g, "\\$&")), `missing GST implementation token ${token}`);
  }
});
