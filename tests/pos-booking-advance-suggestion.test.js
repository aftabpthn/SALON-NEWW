import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bookingPaymentsRoutes = readFileSync("server/routes/booking-payments.routes.js", "utf8");
const posSettings = readFileSync("src/app/core/pos-settings.service.ts", "utf8");
const posPage = readFileSync("src/app/pages/pos.component.ts", "utf8");
const posInvoicesPage = readFileSync("src/app/pages/pos-invoices.component.ts", "utf8");

test("POS loads booking advance status from the booking payments route", () => {
  assert.match(bookingPaymentsRoutes, /\/booking-payments\/:appointmentId\/status/, "Booking payment status route should stay available");
  assert.match(posPage, /appointmentControl\.valueChanges[\s\S]*loadBookingAdvanceSuggestion\(String\(appointmentId \|\| ''\)\)/, "POS should refresh booking advance when appointment changes");
  assert.match(posPage, /loadBookingAdvanceSuggestion\(appointmentId\);/, "Route-selected appointments should also hydrate booking advance");
  assert.match(posPage, /this\.api\.list<ApiRecord>\(`booking-payments\/\$\{appointmentId\}\/status`\)/, "POS should fetch booking advance from the booking payments status API");
});

test("POS keeps booking advance as an apply-first suggestion instead of auto-paying", () => {
  assert.match(posPage, /Invoice me auto-add nahi hoga jab tak aap apply na karo\./, "POS should explain that booking advance is not auto-applied");
  assert.match(posPage, /applyBookingAdvanceSuggestion\(\)/, "POS should expose an explicit apply action");
  assert.match(posPage, /removeBookingAdvanceSuggestion\(\)/, "POS should allow removing the applied booking advance");
  assert.match(posPage, /mode:\s*'booking_advance'[\s\S]*label:\s*this\.paymentModeLabel\('booking_advance'\)/, "Booking advance should enter invoice settlement only after the user applies it");
});

test("POS drafts preserve applied booking advance and invoice register labels it clearly", () => {
  assert.match(posSettings, /bookingAdvanceAppliedAmount\?: number;/, "POS draft models should persist applied booking advance");
  assert.match(posPage, /bookingAdvanceAppliedAmount:\s*this\.appliedBookingAdvanceAmount\(\)/, "Held and active POS drafts should save applied booking advance");
  assert.match(posPage, /loadBookingAdvanceSuggestion\(String\(draft\.appointmentId \|\| ''\), \{ preserveApplied: true \}\)/, "Restored drafts should reload booking advance while keeping the applied amount");
  assert.match(posInvoicesPage, /if \(modeId === 'booking_advance'\) return 'Booking advance';/, "Invoice register should humanize booking advance payment mode");
});
