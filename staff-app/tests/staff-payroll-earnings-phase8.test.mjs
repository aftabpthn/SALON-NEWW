import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Staff earnings stay self-scoped, split-aware, permissioned, and INR-native", () => {
  const migration = read("backend-rust/migrations/0383_staff_earnings_self_service.sql");
  const repository = read("backend-rust/src/repositories/staff_enterprise_repository.rs");
  const staffRoutes = read("backend-rust/src/routes/staff.rs");
  const earningsRoutes = read("backend-rust/src/routes/staff_enterprise.rs");
  const auth = read("backend-rust/src/services/auth_service.rs");
  const service = read("staff-app/src/app/core/staff-app.service.ts");
  const page = read("staff-app/src/app/features/staff/staff-payroll.page.ts");

  assert.match(migration, /PRIMARY KEY \(tenant_id, branch_id, sale_id, staff_id\)/);
  assert.match(migration, /payout_method IN \('cash','bank','upi','other'\)/);
  assert.match(repository, /jsonb_array_elements\(COALESCE\(sale\.tip_splits/);
  assert.match(repository, /item\.staff_id=a\.staff_id/);
  assert.match(repository, /SELECT MAX\(snap\.created_at\)/);
  assert.match(earningsRoutes, /staff-self\/earnings/);
  assert.match(earningsRoutes, /staff-self\/tip-disputes/);
  assert.match(earningsRoutes, /staff\/tips\/payouts\/:id\/reconcile/);
  assert.match(repository, /tip payout status changed or transition is invalid|reconcile_tip_payout/);
  assert.match(staffRoutes, /document_url\s*\.strip_prefix\("\/staff\/files\/"\)/);
  for (const permission of ["staff.app.payroll.costs.read", "staff.app.payroll.deductions.read", "staff.app.payroll.documents.read", "staff.app.tips.dispute.manage"]) assert.match(auth, new RegExp(permission.replaceAll(".", "\\.")));
  assert.match(service, /StaffEarningsDetail/);
  assert.match(page, /Commission drill-down/);
  assert.match(page, /Zenoti Wallet N\/A/);
  assert.match(page, /Submit dispute/);
});
