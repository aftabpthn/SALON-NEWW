import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const invoiceReports = readFileSync("src/app/pages/invoice-reports.component.ts", "utf8");

test("invoice reports Product Sales tab has Salonist-style KPI cards", () => {
  for (const label of [
    "Total Product",
    "Products Sale",
    "Tax On Products",
    "Taxable Amount",
    "Discount",
    "Products Sale After Discount",
    "Gross Margin",
    "Low Stock Items"
  ]) {
    assert.match(invoiceReports, new RegExp(label), `missing Product Sales KPI: ${label}`);
  }

  assert.match(invoiceReports, /productSalesSummary\(\): ProductSalesSummary/);
  assert.match(invoiceReports, /product-sales-kpis/);
});

test("invoice reports Product Sales table includes detailed retail columns", () => {
  for (const label of [
    "Product",
    "Name",
    "Contact",
    "Invoice No",
    "Qty",
    "Price",
    "Total Price",
    "Tax in %",
    "Tax On Products",
    "Total Price After Discount",
    "SKU / Barcode",
    "Stock Signal",
    "Margin %"
  ]) {
    assert.match(invoiceReports, new RegExp(label.replace(/[/%]/g, "\\$&")), `missing Product Sales column: ${label}`);
  }

  assert.match(invoiceReports, /productSalesRows\(\): ApiRecord\[\]/);
  assert.match(invoiceReports, /Product, customer, barcode or invoice/);
});

test("invoice reports enrich product sales with product master data", () => {
  assert.match(invoiceReports, /products: this\.safeList\('products'/);
  assert.match(invoiceReports, /readonly products = signal<ApiRecord\[\]>\(\[\]\)/);
  assert.match(invoiceReports, /productLookupKey/);
  assert.match(invoiceReports, /productStockSignal/);
  assert.match(invoiceReports, /productSalesControlCards\(\)/);
});
