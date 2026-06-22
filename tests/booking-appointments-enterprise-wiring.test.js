import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schedulerRoutes = readFileSync("server/routes/enterprise-scheduler.routes.js", "utf8");
const safetyRoutes = readFileSync("server/routes/appointment-safety.routes.js", "utf8");
const schedulerService = readFileSync("server/services/enterprise-scheduler.service.js", "utf8");
const lifecycleService = readFileSync("server/services/appointment-lifecycle.service.js", "utf8");
const appointmentPage = readFileSync("src/app/pages/appointments-enterprise.component.ts", "utf8");
const calendarWorker = readFileSync("server/workers/handlers/calendar-sync.handler.js", "utf8");

test("booking appointments enterprise flow exposes lifecycle, deposits and operations queue", () => {
  assert.match(schedulerRoutes, /\/enterprise-scheduler\/context/, "Scheduler context API should be wired");
  assert.match(schedulerRoutes, /\/enterprise-scheduler\/appointments\/:id\/billing-status/, "Scheduler should expose live billing-status API for appointment drawers");
  assert.match(schedulerRoutes, /\/enterprise-scheduler\/multi-service-bookings/, "Multi-service booking API should be wired");
  assert.match(schedulerRoutes, /\/enterprise-scheduler\/appointments\/:id\/move/, "Drag/resize move API should be wired");
  assert.match(safetyRoutes, /\/appointments\/:id\/reschedule/, "Reschedule lifecycle API should be wired");
  assert.match(safetyRoutes, /\/appointments\/:id\/cancel/, "Cancel lifecycle API should be wired");
  assert.match(safetyRoutes, /\/appointments\/:id\/no-show/, "No-show lifecycle API should be wired");
  assert.match(safetyRoutes, /\/calendar\/tokens/, "Calendar token API should be wired");

  assert.match(lifecycleService, /waitlistService\.autoFillForFreedSlot/, "Cancellation should offer freed slots to waitlist");
  assert.match(lifecycleService, /APPOINTMENT_ACTIVITY_ACTIONS\.RESCHEDULED/, "Reschedule should write activity history");
  assert.match(schedulerService, /smartBookingService\.findConflicts/, "Booking should reuse conflict prevention wrapper");
  assert.match(schedulerService, /actionQueue/, "Scheduler context should expose an action queue");
  assert.match(schedulerService, /conflict_detection/, "Action queue should include conflict detection");
  assert.match(schedulerService, /deposit_follow_up/, "Action queue should include deposit follow-up");
  assert.match(schedulerService, /no_show_recovery/, "Action queue should include no-show recovery");
  assert.match(schedulerService, /waitlist_match/, "Action queue should include waitlist matching");
  assert.match(schedulerService, /staff_service_matching/, "Action queue should include staff/service matching");
  assert.match(schedulerService, /capacity_optimization/, "Action queue should include capacity optimization");
  assert.match(schedulerService, /calendar_sync/, "Action queue should include calendar sync visibility");
  assert.match(schedulerService, /billingLocked:\s*billedAppointmentIds\.has/, "Scheduler context should mark already-billed appointments");
  assert.match(schedulerService, /rawStatus === "completed" && appointment\.billingLocked \? "billed" : rawStatus/, "Completed summary should move billed appointments out of ready-to-bill count");
  assert.match(schedulerService, /appointmentBillingStatus\(idValue,\s*access = \{\}\)/, "Scheduler service should support live appointment billing lookups");

  assert.match(appointmentPage, /appointment-deposits\/multi-service-bookings/, "Appointment page should create bookings through deposit gate");
  assert.match(appointmentPage, /Booking action queue/, "Appointment page should show the operations action queue");
  assert.match(appointmentPage, /actionTypeLabel/, "Appointment page should label action queue types");
  assert.match(appointmentPage, /handleAppointmentAction/, "Appointment drawer should expose lifecycle actions");
  assert.match(appointmentPage, /enterprise-scheduler\/appointments\/\$\{appointment\.id\}\/move/, "Appointment drag/resize should use scheduler move API");
  assert.match(appointmentPage, /appointmentBillingLocked\(appointment\)/, "Appointment drawer should detect already-billed appointments");
  assert.match(appointmentPage, /Already billed/, "Appointment drawer should replace POS handoff with billed lock text");
  assert.match(appointmentPage, /Checking bill\.\.\./, "Appointment drawer should show live billing check state");
  assert.match(appointmentPage, /refreshAppointmentBillingStatus\(appointment\)/, "Opening the appointment drawer should refresh billing status live");
  assert.match(appointmentPage, /enterprise-scheduler\/appointments\/\$\{appointmentId\}\/billing-status/, "Appointment page should call live billing-status API before POS handoff");
  assert.match(appointmentPage, /ka bill already ban chuka hai/, "Appointment page should block billed bookings from opening POS again");
  assert.match(appointmentPage, /unavailableBlocksByStaff/, "Appointment calendar should render off-shift unavailable blocks");
  assert.match(appointmentPage, /isStaffWorkingAt\(staff\.id,\s*slot\.minute\)/, "Quick booking should respect rostered shift time");
  assert.match(appointmentPage, /pointer-events:\s*none/, "Shift blocks should not block clicks inside working hours");
  assert.match(appointmentPage, /Off shift/, "Calendar should label non-working roster time");
  assert.doesNotMatch(calendarWorker, /queued-placeholder|placeholder/i, "Calendar sync worker should not return queued-placeholder behavior");
});
