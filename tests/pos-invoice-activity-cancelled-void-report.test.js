import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("src/app/pages/pos-invoice-activity.component.ts", "utf8");

test("pos invoice activity exposes cancelled and voided bill register polish", () => {
  for (const label of [
    "Cancelled / Void-ed Bill",
    "Cancelled and soft-deleted bill register",
    "Total Bill",
    "Total Sale",
    "Received Amount",
    "Pending Amount",
    "Name",
    "Contact",
    "Invoice No",
    "Price",
    "Paid",
    "Balance",
    "Reason",
    "Name, phone or invoice"
  ]) {
    assert.match(component, new RegExp(label.replace(/[/?]/g, "\\$&")), `missing cancelled/void bill label: ${label}`);
  }

  assert.match(component, /cancelledVoidRowsCache/);
  assert.match(component, /rebuildCancelledVoidViewModel/);
  assert.match(component, /exportCancelledVoidCsv/);
  assert.match(component, /exportCancelledVoidPdf/);
  assert.match(component, /reviewCancelledVoidBill/);
  assert.match(component, /isCancelledVoidActivity/);
});

test("pos invoice activity uses compact tabbed report layout", () => {
  for (const label of [
    "Activity log",
    "Cancelled / Void",
    "Reports",
    "Invoice & client",
    "Staff / branch",
    "Financial impact",
    "Audit user"
  ]) {
    assert.match(component, new RegExp(label.replace(/[/?]/g, "\\$&")), `missing compact layout label: ${label}`);
  }

  assert.match(component, /activityView: InvoiceActivityView = 'activity'/);
  assert.match(component, /setActivityView\(view: InvoiceActivityView\)/);
  assert.match(component, /activityView !== 'activity'/);
  assert.match(component, /max-height: min\(680px, calc\(100vh - 230px\)\)/);
  assert.match(component, /-webkit-line-clamp: 2/);
});
