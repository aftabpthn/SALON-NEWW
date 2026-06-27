import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(path, "utf8");

test("invoice reports expose detailed unpaid due recovery columns and filters", () => {
  const reports = read("src/app/pages/invoice-reports.component.ts");

  for (const label of [
    "Invoice time",
    "Services",
    "Due paid date",
    "Due paid time",
    "Received by",
    "Receiver ID",
    "Settlement/payment ID",
    "Reference no.",
    "Days to recovery",
    "Partial payment history",
    "0-7 days",
    "8-15 days",
    "16-30 days",
    "30+ days"
  ]) {
    assert.match(reports, new RegExp(label.replace(/[/?]/g, "\\$&")), `missing report label ${label}`);
  }

  assert.match(reports, /Staff Unpaid Services/);
  assert.match(reports, /staffUnpaidRows/);
  assert.match(reports, /recoveryStatus/);
  assert.match(reports, /paymentModeFilter/);
  assert.match(reports, /receivedByFilter/);
  assert.match(reports, /exportPdf/);
  assert.match(reports, /simplePdf/);
});

test("pos invoice detail shows due recovery audit trail", () => {
  const posInvoices = read("src/app/pages/pos-invoices.component.ts");

  assert.match(posInvoices, /Received due history/);
  assert.match(posInvoices, /paymentReceiverLabel/);
  assert.match(posInvoices, /settlementPaymentId/);
  assert.match(posInvoices, /paymentReference/);
  assert.match(posInvoices, /daysToRecovery/);
  assert.match(posInvoices, /recoveryDays/);
});
