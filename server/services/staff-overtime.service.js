import { randomUUID } from "node:crypto";
import { db } from "../db.js";

export const STANDARD_OVERTIME_POLICY = "standard-v1";

const hhmmPattern = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function wholeMinutes(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function timeParts(value) {
  const match = String(value || "").trim().match(hhmmPattern);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

function timestamp(value, businessDate = "") {
  const parts = timeParts(value);
  if (parts && datePattern.test(businessDate)) {
    return Date.parse(`${businessDate}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:00+05:30`);
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function minutesBetween(start, end) {
  const startParts = timeParts(start);
  const endParts = timeParts(end);
  if (startParts && endParts) {
    const startMinutes = startParts.hour * 60 + startParts.minute;
    let endMinutes = endParts.hour * 60 + endParts.minute;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    return endMinutes - startMinutes;
  }
  const startAt = timestamp(start);
  const endAt = timestamp(end);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) return 0;
  return Math.floor((endAt - startAt) / 60000);
}

export function calculateOvertime({ grossMinutes = 0, completedBreakMinutes = 0, scheduledShiftMinutes = 0, hasSchedule = true } = {}) {
  const gross = wholeMinutes(grossMinutes);
  const breaks = wholeMinutes(completedBreakMinutes);
  const scheduled = wholeMinutes(scheduledShiftMinutes);
  const worked = Math.max(0, gross - breaks);
  return {
    grossMinutes: gross,
    completedBreakMinutes: breaks,
    workedMinutes: worked,
    scheduledMinutes: scheduled,
    overtimeMinutes: hasSchedule ? Math.max(0, worked - scheduled) : 0
  };
}

function scheduleInterval(schedule, businessDate) {
  const startTime = schedule.startTime || schedule.start_time || "";
  const endTime = schedule.endTime || schedule.end_time || "";
  const startAt = timestamp(startTime, businessDate);
  let endAt = timestamp(endTime, businessDate);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null;
  if (endAt <= startAt) endAt += 24 * 60 * 60000;
  return { schedule, startAt, endAt, scheduledMinutes: Math.floor((endAt - startAt) / 60000) };
}

export function matchSchedule(schedules = [], { businessDate = "", clockInAt = "" } = {}) {
  const clockAt = timestamp(clockInAt, businessDate);
  const candidates = schedules
    .filter((schedule) => String(schedule.status || "scheduled").toLowerCase() !== "cancelled")
    .map((schedule) => scheduleInterval(schedule, businessDate))
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      containsClockIn: Number.isFinite(clockAt) && clockAt >= candidate.startAt && clockAt <= candidate.endAt,
      distance: Number.isFinite(clockAt) ? Math.abs(clockAt - candidate.startAt) : candidate.startAt
    }))
    .sort((left, right) => Number(right.containsClockIn) - Number(left.containsClockIn)
      || left.distance - right.distance
      || String(left.schedule.id || "").localeCompare(String(right.schedule.id || "")));
  return candidates[0] || null;
}

export function istBusinessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function rangeStartForWeek(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay() || 7;
  return addDays(date, 1 - day);
}

function sourceKey(value) {
  return value === "staff_attendance" ? "staff_attendance" : "staff_attendance_logs";
}

class StaffOvertimeService {
  schedulesFor({ tenantId, branchId, staffId, businessDate }) {
    return db.prepare(`SELECT * FROM staff_schedules
      WHERE tenant_id = @tenantId AND branch_id = @branchId AND staff_id = @staffId
        AND schedule_date = @businessDate AND status != 'cancelled'
      ORDER BY start_time, id`).all({ tenantId, branchId, staffId, businessDate });
  }

  registerAttendance({ tenantId, branchId, staffId, attendanceId, businessDate, clockInAt = "", attendanceSource = "staff_attendance_logs", schedules } = {}) {
    const source = sourceKey(attendanceSource);
    const existing = this.snapshot(tenantId, source, attendanceId);
    if (existing) return existing;
    const matched = matchSchedule(schedules || this.schedulesFor({ tenantId, branchId, staffId, businessDate }), { businessDate, clockInAt });
    const row = {
      id: `ot_${randomUUID().slice(0, 12)}`,
      tenantId,
      branchId,
      attendanceSource: source,
      attendanceId,
      staffId,
      businessDate,
      policyVersion: STANDARD_OVERTIME_POLICY,
      scheduleId: matched?.schedule?.id || "",
      scheduledMinutes: matched?.scheduledMinutes || 0,
      calculationStatus: matched ? "eligible" : "review_required",
      reviewReason: matched ? "" : "missing_schedule"
    };
    db.prepare(`INSERT OR IGNORE INTO staffAttendanceOvertimeSnapshots
      (id, tenantId, branchId, attendanceSource, attendanceId, staffId, businessDate, policyVersion, scheduleId, scheduledMinutes, calculationStatus, reviewReason)
      VALUES (@id, @tenantId, @branchId, @attendanceSource, @attendanceId, @staffId, @businessDate, @policyVersion, @scheduleId, @scheduledMinutes, @calculationStatus, @reviewReason)`).run(row);
    return this.snapshot(tenantId, source, attendanceId);
  }

  snapshot(tenantId, attendanceSource, attendanceId) {
    if (!tenantId || !attendanceId) return null;
    return db.prepare(`SELECT * FROM staffAttendanceOvertimeSnapshots
      WHERE tenantId = @tenantId AND attendanceSource = @attendanceSource AND attendanceId = @attendanceId`)
      .get({ tenantId, attendanceSource: sourceKey(attendanceSource), attendanceId }) || null;
  }

  completeSnapshot({ tenantId, attendanceSource, attendanceId, clockInAt, clockOutAt, completedBreakMinutes = 0 } = {}) {
    const snapshot = this.snapshot(tenantId, attendanceSource, attendanceId);
    if (!snapshot) return null;
    const grossMinutes = minutesBetween(clockInAt, clockOutAt);
    const validWindow = Boolean(clockInAt && clockOutAt && (grossMinutes > 0 || String(clockInAt) === String(clockOutAt)));
    const hasSchedule = Boolean(snapshot.scheduleId) && validWindow;
    const result = calculateOvertime({
      grossMinutes,
      completedBreakMinutes,
      scheduledShiftMinutes: snapshot.scheduledMinutes,
      hasSchedule
    });
    const calculationStatus = hasSchedule ? "completed" : "review_required";
    const reviewReason = !validWindow ? "invalid_time_window" : (snapshot.scheduleId ? "" : "missing_schedule");
    db.prepare(`UPDATE staffAttendanceOvertimeSnapshots SET
      grossMinutes = @grossMinutes,
      completedBreakMinutes = @completedBreakMinutes,
      workedMinutes = @workedMinutes,
      overtimeMinutes = @overtimeMinutes,
      calculationStatus = @calculationStatus,
      reviewReason = @reviewReason,
      completedAt = @completedAt,
      updatedAt = CURRENT_TIMESTAMP
      WHERE tenantId = @tenantId AND attendanceSource = @attendanceSource AND attendanceId = @attendanceId`).run({
        ...result,
        calculationStatus,
        reviewReason,
        completedAt: clockOutAt || new Date().toISOString(),
        tenantId,
        attendanceSource: sourceKey(attendanceSource),
        attendanceId
      });
    return { ...result, calculationStatus, reviewReason, policyVersion: snapshot.policyVersion, scheduleId: snapshot.scheduleId };
  }

  completeStaffOsAttendance(attendance, clockOutAt) {
    const snapshot = this.snapshot(attendance.tenant_id, "staff_attendance_logs", attendance.id);
    if (!snapshot) return null;
    db.prepare(`UPDATE staff_breaks SET ended_at = @endedAt, status = 'ended'
      WHERE tenant_id = @tenantId AND attendance_id = @attendanceId AND status = 'active'`)
      .run({ endedAt: clockOutAt, tenantId: attendance.tenant_id, attendanceId: attendance.id });
    const completedBreakMinutes = db.prepare(`SELECT started_at, ended_at FROM staff_breaks
      WHERE tenant_id = @tenantId AND attendance_id = @attendanceId AND status = 'ended'`)
      .all({ tenantId: attendance.tenant_id, attendanceId: attendance.id })
      .reduce((total, row) => total + minutesBetween(row.started_at, row.ended_at), 0);
    return this.completeSnapshot({
      tenantId: attendance.tenant_id,
      attendanceSource: "staff_attendance_logs",
      attendanceId: attendance.id,
      clockInAt: attendance.clock_in_at,
      clockOutAt,
      completedBreakMinutes
    });
  }

  decorateAttendanceRows(rows = [], tenantId) {
    if (!rows.length) return [];
    const ids = rows.map((row) => String(row.id));
    const params = { tenantId };
    const placeholders = ids.map((id, index) => {
      params[`id${index}`] = id;
      return `@id${index}`;
    }).join(", ");
    const snapshots = db.prepare(`SELECT * FROM staffAttendanceOvertimeSnapshots
      WHERE tenantId = @tenantId AND attendanceSource = 'staff_attendance_logs' AND attendanceId IN (${placeholders})`).all(params);
    const breaks = db.prepare(`SELECT attendance_id, started_at, ended_at FROM staff_breaks
      WHERE tenant_id = @tenantId AND attendance_id IN (${placeholders}) AND status = 'ended'`).all(params);
    const snapshotByAttendance = new Map(snapshots.map((row) => [String(row.attendanceId), row]));
    const breakByAttendance = new Map();
    for (const row of breaks) {
      const key = String(row.attendance_id);
      breakByAttendance.set(key, Number(breakByAttendance.get(key) || 0) + minutesBetween(row.started_at, row.ended_at));
    }
    return rows.map((row) => {
      const snapshot = snapshotByAttendance.get(String(row.id));
      const completed = snapshot?.calculationStatus === "completed";
      const grossMinutes = completed ? Number(snapshot.grossMinutes || 0) : minutesBetween(row.clockInAt, row.clockOutAt || new Date().toISOString());
      const totalBreakMinutes = completed ? Number(snapshot.completedBreakMinutes || 0) : Number(breakByAttendance.get(String(row.id)) || 0);
      return {
        ...row,
        grossMinutes,
        totalBreakMinutes,
        totalWorkedMinutes: completed ? Number(snapshot.workedMinutes || 0) : Math.max(0, grossMinutes - totalBreakMinutes),
        scheduledShiftMinutes: snapshot ? Number(snapshot.scheduledMinutes || 0) : null,
        overtimeCalculationStatus: snapshot?.calculationStatus || "legacy",
        overtimeReviewReason: snapshot?.reviewReason || "",
        overtimePolicyVersion: snapshot?.policyVersion || ""
      };
    });
  }

  summary({ tenantId, branchId = "", staffId, asOf = istBusinessDate() } = {}) {
    const weekStart = rangeStartForWeek(asOf);
    const weekEnd = addDays(weekStart, 6);
    const last30DaysStart = addDays(asOf, -29);
    const params = { tenantId, branchId, staffId, asOf, weekStart, weekEnd, last30DaysStart };
    const branchFilter = branchId ? "AND branch_id = @branchId" : "";
    const row = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN business_date = @asOf THEN overtime_minutes ELSE 0 END), 0) AS todayMinutes,
      COALESCE(SUM(CASE WHEN business_date >= @weekStart AND business_date <= @weekEnd THEN overtime_minutes ELSE 0 END), 0) AS weekMinutes,
      COALESCE(SUM(CASE WHEN business_date >= @last30DaysStart AND business_date <= @asOf THEN overtime_minutes ELSE 0 END), 0) AS last30DaysMinutes,
      COALESCE(SUM(overtime_minutes), 0) AS lifetimeMinutes
      FROM staff_attendance_logs
      WHERE tenant_id = @tenantId ${branchFilter} AND staff_id = @staffId AND status = 'clocked_out'`).get(params);
    return {
      asOf,
      weekStart,
      weekEnd,
      last30DaysStart,
      todayMinutes: Number(row.todayMinutes || 0),
      weekMinutes: Number(row.weekMinutes || 0),
      last30DaysMinutes: Number(row.last30DaysMinutes || 0),
      lifetimeMinutes: Number(row.lifetimeMinutes || 0)
    };
  }

  periodTotalsByStaff({ tenantId, branchId = "", periodStart, periodEnd } = {}) {
    const params = { tenantId, branchId, periodStart, periodEnd };
    const branchFilter = branchId ? "AND branch_id = @branchId" : "";
    const rows = db.prepare(`SELECT staff_id AS staffId, COALESCE(SUM(overtime_minutes), 0) AS overtimeMinutes
      FROM staff_attendance_logs
      WHERE tenant_id = @tenantId ${branchFilter} AND business_date >= @periodStart AND business_date <= @periodEnd AND status = 'clocked_out'
      GROUP BY staff_id`).all(params);
    return new Map(rows.map((row) => [String(row.staffId), Number(row.overtimeMinutes || 0)]));
  }
}

export const staffOvertimeService = new StaffOvertimeService();
