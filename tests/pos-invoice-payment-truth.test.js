import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appointmentLifecycle = readFileSync("server/services/appointment-lifecycle.service.js", "utf8");
const posInvoicesPage = readFileSync("src/app/pages/pos-invoices.component.ts", "utf8");
const invoicePaymentCollectionService = readFileSync("server/services/invoice-payment-collection.service.js", "utf8");

test("appointment billing keeps booking lifecycle status intact", () => {
  assert.match(appointmentLifecycle, /repositories\.appointments\.update\(current\.id,\s*\{\s*status:\s*current\.status,\s*billable:\s*1\s*\}/, "Converting appointment to sale should keep completed booking status");
  assert.doesNotMatch(appointmentLifecycle, /status:\s*paid\s*\?\s*"paid"\s*:\s*"billed"/, "Appointment billing should not overwrite booking lifecycle with paid or billed");
});

test("POS invoice register derives payment truth from paid and due values", () => {
  assert.match(posInvoicesPage, /documentStatus:\s*string;/, "POS invoice rows should keep document status separate from payment truth");
  assert.match(posInvoicesPage, /status:\s*paymentStatus,/, "POS register badge should be driven by payment truth");
  assert.match(posInvoicesPage, /paymentStatusForInvoice\(invoice,\s*total,\s*paid,\s*balance\)/, "POS register should normalize payment status from invoice totals");
  assert.match(posInvoicesPage, /<div><span>Invoice state<\/span><strong>\{\{ invoice\.documentStatus \|\| '-' \}\}<\/strong><\/div>/, "Invoice detail should show document state separately");
});

test("invoice payment collection exposes booking advance separately from invoice settlement", () => {
  assert.match(invoicePaymentCollectionService, /function bookingAdvanceSummary\(invoice = \{\}, tenantId = DEFAULT_TENANT_ID\)/, "Invoice payment collection should summarize booking advance separately");
  assert.match(invoicePaymentCollectionService, /bookingAdvancePaid:\s*advance\.bookingAdvancePaid/, "Invoice summary should expose paid booking advance without adding it to invoice paid amount");
  assert.match(invoicePaymentCollectionService, /bookingAdvancePending:\s*advance\.bookingAdvancePending/, "Invoice summary should expose pending booking advance without adding it to invoice due amount");
  assert.match(posInvoicesPage, /Advance is tracked separately from invoice settlement\./, "POS detail should explain that booking advance is not invoice settlement");
});
