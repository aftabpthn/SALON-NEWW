import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("server/services/staff-business.service.js", "utf8");
const route = readFileSync("server/routes/staff-business.routes.js", "utf8");
const appRoutes = readFileSync("customer-app/src/app/app.routes.ts", "utf8");
const page = readFileSync("customer-app/src/app/features/staff/staff-business.page.ts", "utf8");

test("staff business endpoint keeps billing scoped, permission controlled and normalized to paise", () => {
  assert.match(route, /\/staff-self\/business/);
  assert.match(route, /requirePermission\("read", \(\) => "appointments"\)/);
  assert.match(service, /can\(access\.role \|\| "staff", "read", resource, access\)/);
  assert.match(service, /tenantColumn.*tenant_id/);
  assert.match(service, /branchColumn.*branch_id/);
  assert.match(service, /Math\.round\(value \* \(\/paise\/i\.test\(key\) \? 1 : 100\)\)/);
  assert.match(service, /discountPaise = Math\.max\(0, totalDiscountPaise - couponDiscountPaise\)/);
  assert.match(service, /afterDiscountPaise: Math\.max\(0, subtotalPaise - totalDiscountPaise\)/);
  assert.match(service, /completedMinutes:/);
});

test("staff portal exposes Business and keeps Queue as a compatibility alias", () => {
  assert.match(appRoutes, /path: "business"/);
  assert.match(appRoutes, /path: "queue", redirectTo: "business", pathMatch: "full"/);
  assert.match(page, /Worked time/);
  assert.match(page, /Bill amount/);
  assert.match(page, /Billing details are restricted for your role/);
  assert.match(page, /startService\(appointmentId\)/);
  assert.match(page, /completeService\(appointmentId\)/);
});
