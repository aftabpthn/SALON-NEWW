import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { staffBusinessPerformanceTestUtils } from "../server/services/staff-business-performance.service.js";

const wrapper = readFileSync("server/services/staff-business.service.js", "utf8");
const performanceService = readFileSync("server/services/staff-business-performance.service.js", "utf8");
const salesReport = readFileSync("server/services/staff-sales-report.service.js", "utf8");
const staffOs = readFileSync("server/services/staff-os.service.js", "utf8");
const route = readFileSync("server/routes/staff-business.routes.js", "utf8");
const mobileRoutes = readFileSync("server/routes/staff-mobile.routes.js", "utf8");
const appRoutes = readFileSync("staff-app/src/app/app.routes.ts", "utf8");
const appService = readFileSync("staff-app/src/app/core/staff-app.service.ts", "utf8");
const page = readFileSync("staff-app/src/app/features/staff/staff-business.page.ts", "utf8");

test("activity logs produce actual duration, overrun and explicit estimated fallback", () => {
  const appointment = {
    id: "appt_1",
    clientName: "Client",
    status: "completed",
    startAt: "2026-06-01T04:30:00.000Z",
    endAt: "2026-06-01T05:30:00.000Z"
  };
  const actual = staffBusinessPerformanceTestUtils.activityTimer(appointment, [
    { action: "STARTED", createdAt: "2026-06-01T04:50:00.000Z" },
    { action: "COMPLETED", createdAt: "2026-06-01T06:00:00.000Z" }
  ], "2026-06-01");
  assert.equal(actual.timeSource, "actual");
  assert.equal(actual.elapsedMinutes, 70);
  assert.equal(actual.overrunMinutes, 10);
  assert.equal(actual.progress, 100);

  const estimated = staffBusinessPerformanceTestUtils.activityTimer(appointment, [], "2026-06-01");
  assert.equal(estimated.timeSource, "estimated");
  assert.equal(estimated.elapsedMinutes, 60);
  assert.equal(estimated.overrunMinutes, 0);
});

test("integer-paise staff allocation is deterministic and exact across split staff", () => {
  const rows = [
    { staffId: "staff_a", amount: 1 },
    { staffId: "staff_b", amount: 2 }
  ];
  assert.equal(staffBusinessPerformanceTestUtils.allocatePaise(10001, rows, new Set(["staff_a"])), 3333);
  assert.equal(staffBusinessPerformanceTestUtils.allocatePaise(10001, rows, new Set(["staff_b"])), 6668);
});

test("range parser keeps legacy date compatibility and inclusive IST boundaries", () => {
  const legacy = staffBusinessPerformanceTestUtils.businessRange({ date: "2024-02-29" });
  assert.equal(legacy.from, "2024-02-29");
  assert.equal(legacy.to, "2024-02-29");
  assert.equal(legacy.fromUtc, "2024-02-28T18:30:00.000Z");
  assert.equal(legacy.toUtc, "2024-02-29T18:30:00.000Z");
  assert.throws(() => staffBusinessPerformanceTestUtils.businessRange({ from: "2026-07-02", to: "2026-07-01" }), /on or before/);
  assert.throws(() => staffBusinessPerformanceTestUtils.businessRange({ date: "2025-02-29" }), /YYYY-MM-DD/);
});

test("backend uses bounded batches, self attribution, independent range data and protected invoice detail", () => {
  assert.match(wrapper, /staffBusinessPerformanceService\.daily/);
  assert.match(performanceService, /limit: 400/);
  assert.match(performanceService, /pageSize = positiveInteger\(query\.pageSize, 50, 100\)/);
  assert.match(performanceService, /appointment_activity_log/);
  assert.match(performanceService, /staff_attendance_logs/);
  assert.match(performanceService, /staff_commissions/);
  assert.match(performanceService, /staff_tips/);
  assert.match(performanceService, /staff_payroll_items/);
  assert.match(performanceService, /staff_targets/);
  assert.match(performanceService, /streamCsv/);
  assert.match(performanceService, /Actual Start/);
  assert.match(performanceService, /Attributed After Discount INR/);
  assert.match(salesReport, /export function attributedSalesItems/);
  assert.match(route, /\/staff-self\/business\/invoices\/:invoiceId/);
  assert.match(route, /requirePermission\("read", \(\) => "invoices"\)/);
  assert.doesNotMatch(performanceService, /LIMIT 500/);
});

test("restricted responses and CSV omit monetary values while staff lifecycle actions are disabled", () => {
  assert.match(performanceService, /if \(!billingVisible\)/);
  assert.match(performanceService, /performance\[key\] = null/);
  assert.match(performanceService, /return \[\.\.\.work, "Restricted"\]/);
  assert.doesNotMatch(staffOs, /staffAppointmentForAction|staffStartStatuses|staffCompleteStatuses/);
  assert.doesNotMatch(mobileRoutes, /start-service|complete-service/);
});

test("staff portal exposes client-safe Business UI and keeps Queue compatibility", () => {
  assert.match(appRoutes, /path: "business"/);
  assert.match(appRoutes, /path: "queue"/);
  assert.doesNotMatch(appService, /canStartServiceStatus|canCompleteServiceStatus|\/staff-os\/mobile\/(?:start|complete)-service/);
  assert.match(appService, /businessInvoice/);
  assert.match(page, /My attributed revenue/);
  assert.match(page, /Actual.*Estimated/s);
  assert.match(page, />Duty</);
  assert.match(page, /Utilization/);
  assert.match(page, /Earnings & payroll/);
  assert.match(page, /Overlapping targets/);
  assert.match(page, /Clear filters/);
  assert.match(page, /Load More/);
  assert.doesNotMatch(page, /Export CSV/);
  assert.match(page, /document:keydown\.escape/);
  assert.match(page, /focus\(\)/);
});
