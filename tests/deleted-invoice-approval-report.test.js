import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/pages/invoice-reports.component.ts", "utf8");

test("invoice reports expose deleted invoice approval register", () => {
  assert.match(page, /deleted-invoice-approvals/);
  assert.match(page, /Deleted Invoice Approvals/);
  assert.match(page, /Deleted bill register with approval/);

  for (const label of [
    "Total deleted bills",
    "Total sale",
    "Received amount",
    "Pending amount",
    "Approved deletes",
    "Approval gaps",
    "Name",
    "Contact",
    "Invoice No",
    "Price",
    "Paid",
    "Balance",
    "Feedback & Rating",
    "Deleted Date",
    "Deleted Time",
    "Deleted By",
    "Approved By",
    "Approval Status",
    "Reason"
  ]) {
    assert.match(page, new RegExp(label.replace(/[&]/g, "\\$&")), `missing deleted invoice report label ${label}`);
  }
});

test("deleted invoice report reuses activity audit data and exports summary", () => {
  for (const token of [
    "loadInvoiceActivityReport",
    "deletedInvoiceApprovalRows",
    "deletedRowsFromInvoiceActivityReport",
    "deletedRowsFromAuditLogs",
    "deletedRowsFromInvoices",
    "deletedInvoiceApprovalSummary",
    "deletedInvoiceExportSummaryLines",
    "isDeletedInvoiceAudit",
    "auditDetails"
  ]) {
    assert.match(page, new RegExp(token), `missing implementation token ${token}`);
  }
});
