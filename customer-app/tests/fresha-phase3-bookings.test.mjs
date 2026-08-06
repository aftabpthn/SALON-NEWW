import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../src/app/${path}`, import.meta.url), "utf8");

test("booking success survives refresh by loading the real booking id", () => {
  const flow = read("features/booking/booking-flow.page.ts");
  const success = read("features/booking/booking-success.page.ts");
  assert.match(flow, /queryParams: \{ id: booking\.id \}/);
  assert.match(success, /queryParamMap\.get\("id"\)/);
  assert.match(success, /marketplace\.loadBooking\(id\)/);
  assert.match(success, /\['\/bookings', booking\.id\]/);
});

test("booking money and receipts remain API backed", () => {
  const summary = read("features/booking/booking-summary.page.ts");
  const detail = read("features/bookings/booking-detail.page.ts");
  assert.match(summary, /booking\.invoiceTotalPaise/);
  assert.match(summary, /booking\.depositAmountPaise/);
  assert.doesNotMatch(summary, /\* 0\.18|Estimated taxes/);
  assert.match(detail, /loadBookingReceiptHtml\(booking\.id\)/);
  assert.doesNotMatch(detail, /%PDF-1\.4|local receipt generated/);
});

test("booking management reuses live slots and the approved blue theme", () => {
  const bookings = read("features/bookings/bookings.page.ts");
  const detail = read("features/bookings/booking-detail.page.ts");
  assert.match(detail, /queryParams: \{ reschedule: booking\.id \}/);
  assert.match(bookings, /pendingRescheduleId/);
  assert.match(bookings, /openRescheduleSlots\(booking\)/);
  assert.match(bookings, /var\(--primary-2\)/);
  assert.doesNotMatch(`${bookings}\n${detail}`, /#FFF9EC|#7A5019|rgba\(214, 169, 74/);
});
