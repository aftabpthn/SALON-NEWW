import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../server/db.js";
import { ensureStaffOsSchema } from "../server/services/staff-os-schema.service.js";
import { calculateOvertime, matchSchedule, minutesBetween, staffOvertimeService } from "../server/services/staff-overtime.service.js";

test("standard-v1 overtime subtracts completed breaks and clamps at zero", () => {
  assert.deepEqual(calculateOvertime({ grossMinutes: 600, completedBreakMinutes: 30, scheduledShiftMinutes: 540 }), {
    grossMinutes: 600,
    completedBreakMinutes: 30,
    workedMinutes: 570,
    scheduledMinutes: 540,
    overtimeMinutes: 30
  });
  assert.equal(calculateOvertime({ grossMinutes: 420, completedBreakMinutes: 30, scheduledShiftMinutes: 540 }).overtimeMinutes, 0);
  assert.equal(calculateOvertime({ grossMinutes: 600, completedBreakMinutes: 30, scheduledShiftMinutes: 0, hasSchedule: false }).overtimeMinutes, 0);
});

test("schedule matching supports containing, nearest and overnight shifts", () => {
  const schedules = [
    { id: "day", startTime: "10:00", endTime: "19:00", status: "scheduled" },
    { id: "night", startTime: "22:00", endTime: "06:00", status: "scheduled" }
  ];
  assert.equal(matchSchedule(schedules, { businessDate: "2026-07-13", clockInAt: "2026-07-13T17:00:00.000Z" }).schedule.id, "night");
  assert.equal(matchSchedule(schedules, { businessDate: "2026-07-13", clockInAt: "2026-07-13T04:00:00.000Z" }).schedule.id, "day");
  assert.equal(minutesBetween("22:00", "06:00"), 480);
});

test("eligible attendance persists audited OT, closes an active break and powers period summaries", () => {
  ensureStaffOsSchema();
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const tenantId = `tenant_ot_${suffix}`;
  const branchId = `branch_ot_${suffix}`;
  const staffId = `staff_ot_${suffix}`;
  const attendanceId = `att_ot_${suffix}`;
  const scheduleId = `shift_ot_${suffix}`;
  const breakId = `break_ot_${suffix}`;
  const businessDate = "2026-07-13";
  const clockInAt = "2026-07-13T04:30:00.000Z";
  const clockOutAt = "2026-07-13T14:30:00.000Z";
  try {
    db.prepare(`INSERT INTO staff_schedules
      (id, tenant_id, branch_id, staff_id, schedule_date, start_time, end_time)
      VALUES (@id, @tenantId, @branchId, @staffId, @businessDate, '10:00', '19:00')`)
      .run({ id: scheduleId, tenantId, branchId, staffId, businessDate });
    db.prepare(`INSERT INTO staff_attendance_logs
      (id, tenant_id, branch_id, staff_id, business_date, clock_in_at, status)
      VALUES (@id, @tenantId, @branchId, @staffId, @businessDate, @clockInAt, 'clocked_in')`)
      .run({ id: attendanceId, tenantId, branchId, staffId, businessDate, clockInAt });
    const attendance = db.prepare("SELECT * FROM staff_attendance_logs WHERE id = @id").get({ id: attendanceId });
    staffOvertimeService.registerAttendance({ tenantId, branchId, staffId, attendanceId, businessDate, clockInAt });
    db.prepare(`INSERT INTO staff_breaks
      (id, tenant_id, attendance_id, staff_id, branch_id, started_at, status)
      VALUES (@id, @tenantId, @attendanceId, @staffId, @branchId, @startedAt, 'active')`)
      .run({ id: breakId, tenantId, attendanceId, staffId, branchId, startedAt: "2026-07-13T14:00:00.000Z" });

    const calculation = staffOvertimeService.completeStaffOsAttendance(attendance, clockOutAt);
    db.prepare(`UPDATE staff_attendance_logs SET clock_out_at = @clockOutAt, status = 'clocked_out', overtime_minutes = @overtimeMinutes
      WHERE id = @id`).run({ id: attendanceId, clockOutAt, overtimeMinutes: calculation.overtimeMinutes });

    assert.equal(calculation.completedBreakMinutes, 30);
    assert.equal(calculation.workedMinutes, 570);
    assert.equal(calculation.overtimeMinutes, 30);
    assert.equal(db.prepare("SELECT status FROM staff_breaks WHERE id = @id").get({ id: breakId }).status, "ended");
    assert.equal(staffOvertimeService.snapshot(tenantId, "staff_attendance_logs", attendanceId).calculationStatus, "completed");
    assert.deepEqual(staffOvertimeService.summary({ tenantId, branchId, staffId, asOf: businessDate }), {
      asOf: businessDate,
      weekStart: "2026-07-13",
      weekEnd: "2026-07-19",
      last30DaysStart: "2026-06-14",
      todayMinutes: 30,
      weekMinutes: 30,
      last30DaysMinutes: 30,
      lifetimeMinutes: 30
    });
    assert.equal(staffOvertimeService.periodTotalsByStaff({ tenantId, branchId, periodStart: businessDate, periodEnd: businessDate }).get(staffId), 30);
  } finally {
    db.prepare("DELETE FROM staff_breaks WHERE id = @id").run({ id: breakId });
    db.prepare("DELETE FROM staffAttendanceOvertimeSnapshots WHERE attendanceId = @attendanceId").run({ attendanceId });
    db.prepare("DELETE FROM staff_attendance_logs WHERE id = @id").run({ id: attendanceId });
    db.prepare("DELETE FROM staff_schedules WHERE id = @id").run({ id: scheduleId });
  }
});
