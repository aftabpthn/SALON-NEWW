import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("finalized payroll exposes the immutable detailed payslip to Staff App", () => {
  const payroll = read("backend-rust/src/services/staff_payroll_service.rs");
  const repository = read("backend-rust/src/repositories/staff_enterprise_repository.rs");
  const page = read("staff-app/src/app/features/staff/staff-payroll.page.ts");

  assert.match(payroll, /finalized or partially paid payroll cannot be recalculated/);
  assert.match(payroll, /payroll_payslip_available/);
  assert.match(payroll, /Business sales breakup:/);
  assert.match(repository, /r\.status IN \('finalized','partially_paid','paid'\)/);
  assert.match(repository, /'payslipPath','\/staff\/self\/payslips\/'\|\|r\.id/);
  for (const field of ["paidLeaveDaysX2", "approvedOvertimeMinutes", "overtimeRatePaisePerHour", "lateDeductionPaise", "absenceDeductionPaise", "fineDeductionPaise"]) {
    assert.match(repository, new RegExp(field));
  }
  for (const label of ["Paid leave", "Rate / hour", "Services", "Products", "Packages", "Memberships", "Late", "Absence", "Advance", "Fine", "Statutory", "Other", "Download PDF"]) {
    assert.match(page, new RegExp(label));
  }
});
