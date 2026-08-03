import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Staff checkout and register stay scoped, online-only, and provider-tokenized", () => {
  const appointments = read("backend-rust/src/routes/appointments.rs");
  const pos = read("backend-rust/src/routes/pos.rs");
  const tipMigration = read("backend-rust/migrations/0382_staff_pos_tip_splits.sql");
  const auth = read("backend-rust/src/services/auth_service.rs");
  const service = read("staff-app/src/app/core/staff-app.service.ts");
  const page = read("staff-app/src/app/features/staff/staff-appointments.page.ts");
  const business = read("staff-app/src/app/features/staff/staff-business.page.ts");

  for (const route of ["checkout/payments", "checkout/provider-payment", "checkout/upi-link", "checkout/finalize", "register/provider-reconciliations"]) assert.match(appointments, new RegExp(route));
  for (const permission of ["staff.app.pos.manage", "staff.app.pos.lifecycle.manage", "staff.app.register.manage", "staff.app.register.approve"]) assert.match(auth, new RegExp(permission.replaceAll(".", "\\.")));
  assert.match(appointments, /card and UPI require the secure provider flow/);
  assert.match(service, /This action requires an internet connection/);
  assert.match(page, /Never enter card details/);
  assert.match(page, /idempotencyKey:this\.newBookingKey\(\)/);
  assert.match(page, /Tip split total must equal the invoice tip/);
  assert.match(appointments, /tipSplits contains unavailable staff/);
  assert.match(pos, /tip split total must equal tipPaise/);
  assert.match(tipMigration, /jsonb_typeof\(tip_splits\) = 'array'/);
  assert.match(business, /Blind close/);
  assert.match(business, /Provider settlement reconciliation/);
});
