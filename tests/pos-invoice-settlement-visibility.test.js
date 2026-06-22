import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const posInvoicesPage = readFileSync("src/app/pages/pos-invoices.component.ts", "utf8");

test("POS invoice detail highlights booking advance adjustment separately from counter collection", () => {
  assert.match(posInvoicesPage, /Booking advance adjusted/, "Invoice detail should show how much booking advance was adjusted");
  assert.match(posInvoicesPage, /Counter payment collected/, "Invoice detail should show how much was collected at counter");
  assert.match(posInvoicesPage, /Remaining counter payment/, "Invoice detail should show what is still left to collect");
  assert.match(posInvoicesPage, /bookingAdvanceAdjustedAmount\(row: InvoiceRegisterRow\)/, "Invoice detail should derive adjusted advance from booking_advance payment lines");
  assert.match(posInvoicesPage, /counterPaymentCollectedAmount\(row: InvoiceRegisterRow\)/, "Invoice detail should derive counter collection separately from booking advance");
  assert.match(posInvoicesPage, /remainingCounterPaymentAmount\(row: InvoiceRegisterRow\)/, "Invoice detail should keep remaining collect amount visible");
  assert.match(posInvoicesPage, /\.settlement-breakdown/, "Invoice detail should render a dedicated settlement breakdown block");
});
