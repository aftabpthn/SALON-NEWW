import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("server/services/staff-business.service.js", "utf8");
const route = readFileSync("server/routes/staff-business.routes.js", "utf8");
const appRoutes = readFileSync("customer-app/src/app/app.routes.ts", "utf8");
const page = readFileSync("customer-app/src/app/features/staff/staff-business.page.ts", "utf8");

test("staff business endpoint keeps billing scoped, permission controlled and normalized to paise", () => {
  assert.match(route, /\/staff-self\/business/);
  assert.match(route, /\/staff-self\/business\/export\.csv/);
  assert.match(route, /requirePermission\("read", \(\) => "appointments"\)/);
  assert.match(service, /can\(access\.role \|\| "staff", "read", resource, access\)/);
  assert.match(service, /tenantColumn.*tenant_id/);
  assert.match(service, /branchColumn.*branch_id/);
  assert.match(service, /Math\.round\(value \* \(\/paise\/i\.test\(key\) \? 1 : 100\)\)/);
  assert.match(service, /discountPaise = Math\.max\(0, totalDiscountPaise - couponDiscountPaise\)/);
  assert.match(service, /afterDiscountPaise: Math\.max\(0, subtotalPaise - totalDiscountPaise\)/);
  assert.match(service, /completedMinutes:/);
  assert.match(service, /T00:00:00\.000\+05:30/);
  assert.match(service, /pageSize = positiveInteger\(query\.pageSize, 50, 100\)/);
  assert.match(service, /dailyBreakdown/);
  assert.match(service, /hasMore: page < totalPages/);
  assert.doesNotMatch(service, /LIMIT 500/);
});

test("staff portal exposes Business and keeps Queue as a compatibility alias", () => {
  assert.match(appRoutes, /path: "business"/);
  assert.match(appRoutes, /path: "queue", redirectTo: "business", pathMatch: "full"/);
  assert.match(page, /Worked time/);
  assert.match(page, /Bill amount/);
  assert.match(page, /Billing details are restricted for your role/);
  assert.match(page, /startService\(appointmentId\)/);
  assert.match(page, /completeService\(appointmentId\)/);
  assert.match(page, /1 Month/);
  assert.match(page, /3 Months/);
  assert.match(page, /6 Months/);
  assert.match(page, /1 Year/);
  assert.match(page, /Custom Range/);
  assert.match(page, /Load More/);
  assert.match(page, /Export CSV/);
});
