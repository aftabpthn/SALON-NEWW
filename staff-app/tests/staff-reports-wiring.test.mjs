import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const page = readFileSync("src/app/features/staff/staff-reports.page.ts", "utf8");
const appointmentsPage = readFileSync("src/app/features/staff/staff-appointments.page.ts", "utf8");
const appService = readFileSync("../backend-rust/src/services/staff_app_service.rs", "utf8");
const reportRoutes = readFileSync("../backend-rust/src/routes/reports.rs", "utf8");
const managerReport = readFileSync("../frontend-angular/src/app/pages/reports/staff-bookings/staff-bookings-report-page.component.ts", "utf8");

test("staff reports use the selected self-scoped business range and DD/MM/YYYY inputs", () => {
  assert.match(page, /allHistory: this\.historyMode/);
  assert.doesNotMatch(page, /staff\.dashboard\(/);
  assert.match(page, /placeholder="DD\/MM\/YYYY"/);
  assert.match(page, /data\.summary\.appointments/);
  assert.match(page, /data\.summary\.totalPaise/);
  assert.match(page, /data\.dailyBreakdown/);
  assert.match(appService, /summary\["appointmentValuePaise"\]/);
  assert.match(appService, /appointment\.tenant_id=\$1 AND appointment\.branch_id=\$2 AND appointment\.staff_id=\$3/);
});

test("complete appointment history is paginated, filterable and shared with the manager report", () => {
  assert.match(appointmentsPage, />All History</);
  assert.match(appointmentsPage, /pagination\?\.appointmentHasMore/);
  assert.match(appointmentsPage, /serviceId: this\.historyServiceId\(\)/);
  assert.match(appointmentsPage, /Shift \/ reschedule timeline/);
  assert.match(appService, /pub async fn appointment_history/);
  assert.match(appService, /'preferredClient'/);
  assert.match(appService, /'rescheduleTimeline'/);
  assert.match(appService, /'lastServiceDepartments'/);
  assert.match(reportRoutes, /reports\/staff-service-history/);
  assert.match(managerReport, /staff-service-history/);
});
