import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Salonist-style appointment reports backend routes are wired", () => {
  const app = read("server/app.js");
  const route = read("server/routes/appointment-salonist-report.routes.js");
  const service = read("server/services/appointment-salonist-report.service.js");

  assert.match(route, /"\/reports\/appointment-detail-list"/, "detail appointment endpoint should exist");
  assert.match(route, /"\/reports\/staff-appointments"/, "staff appointment endpoint should exist");
  assert.match(route, /requirePermission\("read",\s*\(\) => "reports"\)/, "report permission should protect endpoints");
  assert.match(app, /appointmentSalonistReportRouter/, "app should import appointment Salonist report router");
  assert.match(app, /app\.use\("\/api\/v1",\s*appointmentSalonistReportRouter\)/, "v1 API should mount appointment reports");
  assert.match(app, /app\.use\("\/api",\s*appointmentSalonistReportRouter\)/, "legacy API should mount appointment reports");

  for (const token of [
    "statusGroup",
    "modeGroup",
    "appointmentPrice",
    "notCame",
    "notConfirmed",
    "staffReportRows",
    "averagePrice",
    "serviceFallbackPrice"
  ]) {
    assert.match(service, new RegExp(token), `service should include ${token}`);
  }
});

test("Salonist-style appointment reports frontend pages and links are wired", () => {
  const routes = read("src/app/app.routes.ts");
  const reports = read("src/app/pages/reports.component.ts");
  const detailPage = read("src/app/pages/appointment-detail-list-report.component.ts");
  const staffPage = read("src/app/pages/staff-appointments-report.component.ts");

  assert.match(routes, /reports\/appointment-detail-list/, "detail appointment Angular route should exist");
  assert.match(routes, /reports\/staff-appointments/, "staff appointments Angular route should exist");
  assert.match(reports, /Detail Appointment List/, "reports command center should link detail appointment report");
  assert.match(reports, /Appointment Booked By Staff/, "reports command center should link staff appointment report");
  assert.match(detailPage, /report<AppointmentDetailReport>\('appointment-detail-list'/, "detail page should call detail report API");
  assert.match(staffPage, /report<StaffAppointmentsReport>\('staff-appointments'/, "staff page should call staff report API");

  for (const label of [
    "Detail Appointment List",
    "All Appointments",
    "All Modes",
    "Confirmed",
    "Arrived",
    "Completed",
    "Cancel",
    "Not Came",
    "Not Confirmed",
    "Mode",
    "Services",
    "Appointment Date",
    "Appointment Time",
    "Download"
  ]) {
    assert.match(detailPage, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `detail page missing ${label}`);
  }

  for (const label of [
    "Appointment Booked By Staff",
    "Staff name",
    "Appointment Count",
    "Appointment Price",
    "Completed",
    "Cancel",
    "Not Came",
    "Avg Value",
    "Download"
  ]) {
    assert.match(staffPage, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `staff page missing ${label}`);
  }
});
