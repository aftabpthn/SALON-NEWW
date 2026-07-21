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

export function calculateOvertime({ grossMinutes = 0, completedBreakMinutes = 0, scheduledShiftMinutes = 0, hasSchedule = true, minimumOtDurationMinutes = 0, expectedEndAt = "", clockOutAt = "" } = {}) {
  const gross = wholeMinutes(grossMinutes);
  const breaks = wholeMinutes(completedBreakMinutes);
  const scheduled = wholeMinutes(scheduledShiftMinutes);
  const worked = Math.max(0, gross - breaks);
  const expectedEnd = timestamp(expectedEndAt);
  const clockOut = timestamp(clockOutAt);
  const hasAuthoritativeEnd = Number.isFinite(expectedEnd) && Number.isFinite(clockOut);
  const rawOvertime = hasSchedule
    ? (hasAuthoritativeEnd ? Math.max(0, Math.floor((clockOut - expectedEnd) / 60000)) : Math.max(0, worked - scheduled))
    : 0;
  const minOt = wholeMinutes(minimumOtDurationMinutes);
  return {
    grossMinutes: gross,
    completedBreakMinutes: breaks,
    workedMinutes: worked,
    scheduledMinutes: scheduled,
    overtimeMinutes: minOt > 0 && rawOvertime > 0 && rawOvertime < minOt ? 0 : rawOvertime
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

function parseIds(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function categoryBaseline(category, businessDate, clockInAt) {
  if (!category) return null;
  const duration = wholeMinutes(category.working_duration_minutes);
  let startAt = timestamp(category.in_time, businessDate);
  let endAt = timestamp(category.out_time, businessDate);
  if (Number.isFinite(startAt) && Number.isFinite(endAt) && endAt <= startAt) endAt += 24 * 60 * 60000;
  if (Number.isFinite(startAt) && !Number.isFinite(endAt) && duration) endAt = startAt + duration * 60000;
  if (!Number.isFinite(startAt) && Number.isFinite(endAt) && duration) startAt = endAt - duration * 60000;
  if (!Number.isFinite(startAt) && !Number.isFinite(endAt) && duration) {
    startAt = timestamp(clockInAt, businessDate);
    endAt = startAt + duration * 60000;
  }
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return null;
  return { startAt, endAt, scheduledMinutes: Math.floor((endAt - startAt) / 60000), source: "attendance_category" };
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

  attendanceCategoryFor({ tenantId, branchId, schedule }) {
    const rows = db.prepare(`SELECT * FROM staff_attendance_category_master
      WHERE tenant_id = @tenantId AND status = 'active' AND COALESCE(hide, 0) = 0
        AND (branch_id = @branchId OR branch_id = '')
      ORDER BY CASE WHEN branch_id = @branchId THEN 0 ELSE 1 END,
        updated_at DESC, created_at DESC, id ASC`).all({ tenantId, branchId });
    const shiftKeys = new Set([schedule?.id, schedule?.shift_type, schedule?.shiftType].filter(Boolean).map(String));
    return rows.find((category) => {
      const allowable = parseIds(category.allowable_shift_ids_json);
      return allowable.length === 0 || allowable.some((id) => shiftKeys.has(id));
    }) || null;
  }

  freezeSnapshotPolicy(snapshot, { clockInAt = "", schedules, businessDate = snapshot?.businessDate, branchId = snapshot?.branchId, staffId = snapshot?.staffId, force = false } = {}) {
    if (!snapshot || (snapshot.policyFrozenAt && !force)) return snapshot;
    const alreadyFrozen = Boolean(snapshot.categoryId || snapshot.baselineStartAt || snapshot.expectedEndAt || snapshot.baselineSource);
    const policyFrozenAt = new Date().toISOString();
    if (alreadyFrozen && !force) {
      db.prepare(`UPDATE staffAttendanceOvertimeSnapshots SET policyFrozenAt = @policyFrozenAt, updatedAt = CURRENT_TIMESTAMP
        WHERE tenantId = @tenantId AND attendanceSource = @attendanceSource AND attendanceId = @attendanceId`).run({
        policyFrozenAt,
        tenantId: snapshot.tenantId,
        attendanceSource: snapshot.attendanceSource,
        attendanceId: snapshot.attendanceId
      });
      return this.snapshot(snapshot.tenantId, snapshot.attendanceSource, snapshot.attendanceId);
    }
    const availableSchedules = schedules || this.schedulesFor({
      tenantId: snapshot.tenantId,
      branchId,
      staffId,
      businessDate
    });
    const preferredSchedule = availableSchedules.find((schedule) => String(schedule.id || "") === String(snapshot.scheduleId || ""));
    const matched = preferredSchedule && !force
      ? scheduleInterval(preferredSchedule, businessDate)
      : matchSchedule(availableSchedules, { businessDate, clockInAt });
    const category = this.attendanceCategoryFor({ tenantId: snapshot.tenantId, branchId, schedule: matched?.schedule });
    const baseline = matched ? { ...matched, source: "staff_schedule" } : categoryBaseline(category, businessDate, clockInAt);
    const clockAt = timestamp(clockInAt, businessDate);
    const delayMs = baseline && Number.isFinite(clockAt) ? Math.max(0, clockAt - baseline.startAt) : 0;
    const explicitlyDisabled = force && alreadyFrozen && Number(snapshot.overtimeEnabled || 0) === 0 && snapshot.calculationStatus === "disabled";
    const overtimeEnabled = !explicitlyDisabled && Boolean(category && Number(category.overtime_applicable || 0) === 1);
    const calculationStatus = explicitlyDisabled ? "disabled" : (!category ? "review_required" : (!overtimeEnabled ? "disabled" : (baseline ? "eligible" : "review_required")));
    const reviewReason = explicitlyDisabled ? (snapshot.reviewReason || "not_applicable") : (!category ? "missing_attendance_category" : (!overtimeEnabled ? "not_applicable" : (baseline ? "" : "missing_baseline")));
    db.prepare(`UPDATE staffAttendanceOvertimeSnapshots SET
      branchId = @branchId, staffId = @staffId, businessDate = @businessDate,
      policyVersion = @policyVersion, scheduleId = @scheduleId, categoryId = @categoryId,
      overtimeEnabled = @overtimeEnabled, minimumOtDurationMinutes = @minimumOtDurationMinutes,
      baselineStartAt = @baselineStartAt, expectedEndAt = @expectedEndAt, baselineSource = @baselineSource,
      scheduledMinutes = @scheduledMinutes, calculationStatus = @calculationStatus, reviewReason = @reviewReason,
      policyFrozenAt = @policyFrozenAt, updatedAt = CURRENT_TIMESTAMP
      WHERE tenantId = @tenantId AND attendanceSource = @attendanceSource AND attendanceId = @attendanceId`).run({
        policyVersion: snapshot.policyVersion || STANDARD_OVERTIME_POLICY,
        branchId,
        staffId,
        businessDate,
        scheduleId: matched?.schedule?.id || "",
        categoryId: explicitlyDisabled ? snapshot.categoryId : (category?.id || ""),
        overtimeEnabled: overtimeEnabled ? 1 : 0,
        minimumOtDurationMinutes: explicitlyDisabled ? wholeMinutes(snapshot.minimumOtDurationMinutes) : wholeMinutes(category?.minimum_ot_duration_minutes),
        baselineStartAt: baseline ? new Date(baseline.startAt).toISOString() : "",
        expectedEndAt: baseline ? new Date(baseline.endAt + delayMs).toISOString() : "",
        baselineSource: baseline?.source || "",
        scheduledMinutes: baseline?.scheduledMinutes || 0,
        calculationStatus,
        reviewReason,
        policyFrozenAt,
        tenantId: snapshot.tenantId,
        attendanceSource: snapshot.attendanceSource,
        attendanceId: snapshot.attendanceId
      });
    return this.snapshot(snapshot.tenantId, snapshot.attendanceSource, snapshot.attendanceId);
  }

  refreshSnapshotForCorrection({ tenantId, attendanceSource = "staff_attendance_logs", attendanceId, branchId, staffId, businessDate, clockInAt = "", schedules } = {}) {
    const snapshot = this.snapshot(tenantId, attendanceSource, attendanceId);
    if (!snapshot) return null;
    return this.freezeSnapshotPolicy(snapshot, { clockInAt, schedules, branchId, staffId, businessDate, force: true });
  }

  registerAttendance({ tenantId, branchId, staffId, attendanceId, businessDate, clockInAt = "", attendanceSource = "staff_attendance_logs", schedules } = {}) {
    const source = sourceKey(attendanceSource);
    const existing = this.snapshot(tenantId, source, attendanceId);
    if (existing) return existing;
    const matched = matchSchedule(schedules || this.schedulesFor({ tenantId, branchId, staffId, businessDate }), { businessDate, clockInAt });
    const category = this.attendanceCategoryFor({ tenantId, branchId, schedule: matched?.schedule });
    const categoryFallback = categoryBaseline(category, businessDate, clockInAt);
    const baseline = matched ? { ...matched, source: "staff_schedule" } : categoryFallback;
    const clockAt = timestamp(clockInAt, businessDate);
    const delayMs = baseline && Number.isFinite(clockAt) ? Math.max(0, clockAt - baseline.startAt) : 0;
    const expectedEndAt = baseline ? new Date(baseline.endAt + delayMs).toISOString() : "";
    const overtimeEnabled = Boolean(category && Number(category.overtime_applicable || 0) === 1);
    const calculationStatus = !category ? "review_required" : (!overtimeEnabled ? "disabled" : (baseline ? "eligible" : "review_required"));
    const reviewReason = !category ? "missing_attendance_category" : (!overtimeEnabled ? "not_applicable" : (baseline ? "" : "missing_baseline"));
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
      categoryId: category?.id || "",
      overtimeEnabled: overtimeEnabled ? 1 : 0,
      minimumOtDurationMinutes: wholeMinutes(category?.minimum_ot_duration_minutes),
      baselineStartAt: baseline ? new Date(baseline.startAt).toISOString() : "",
      expectedEndAt,
      baselineSource: baseline?.source || "",
      policyFrozenAt: new Date().toISOString(),
      scheduledMinutes: baseline?.scheduledMinutes || 0,
      calculationStatus,
      reviewReason
    };
    db.prepare(`INSERT OR IGNORE INTO staffAttendanceOvertimeSnapshots
      (id, tenantId, branchId, attendanceSource, attendanceId, staffId, businessDate, policyVersion, scheduleId, categoryId,
       overtimeEnabled, minimumOtDurationMinutes, baselineStartAt, expectedEndAt, baselineSource, policyFrozenAt, scheduledMinutes, calculationStatus, reviewReason)
      VALUES (@id, @tenantId, @branchId, @attendanceSource, @attendanceId, @staffId, @businessDate, @policyVersion, @scheduleId, @categoryId,
       @overtimeEnabled, @minimumOtDurationMinutes, @baselineStartAt, @expectedEndAt, @baselineSource, @policyFrozenAt, @scheduledMinutes, @calculationStatus, @reviewReason)`).run(row);
    return this.snapshot(tenantId, source, attendanceId);
  }

  snapshot(tenantId, attendanceSource, attendanceId) {
    if (!tenantId || !attendanceId) return null;
    return db.prepare(`SELECT * FROM staffAttendanceOvertimeSnapshots
      WHERE tenantId = @tenantId AND attendanceSource = @attendanceSource AND attendanceId = @attendanceId`)
      .get({ tenantId, attendanceSource: sourceKey(attendanceSource), attendanceId }) || null;
  }

  completeSnapshot({ tenantId, attendanceSource, attendanceId, clockInAt, clockOutAt, completedBreakMinutes = 0 } = {}) {
    let snapshot = this.snapshot(tenantId, attendanceSource, attendanceId);
    if (!snapshot) return null;
    snapshot = this.freezeSnapshotPolicy(snapshot, { clockInAt });
    const overtimeApplicable = Number(snapshot.overtimeEnabled || 0) === 1;
    const minimumOtDurationMinutes = Number(snapshot.minimumOtDurationMinutes || 0);
    const grossMinutes = minutesBetween(clockInAt, clockOutAt);
    const validWindow = Boolean(clockInAt && clockOutAt && (grossMinutes > 0 || String(clockInAt) === String(clockOutAt)));
    const hasSchedule = Boolean(snapshot.expectedEndAt) && validWindow && overtimeApplicable;
    const result = calculateOvertime({
      grossMinutes,
      completedBreakMinutes,
      scheduledShiftMinutes: snapshot.scheduledMinutes,
      hasSchedule,
      minimumOtDurationMinutes,
      expectedEndAt: snapshot.expectedEndAt,
      clockOutAt
    });
    const calculationStatus = !overtimeApplicable ? "disabled" : (hasSchedule ? "completed" : "review_required");
    const reviewReason = !overtimeApplicable ? (snapshot.reviewReason || "not_applicable") : (!validWindow ? "invalid_time_window" : (snapshot.expectedEndAt ? "" : "missing_frozen_baseline"));
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
    return { ...result, calculationStatus, reviewReason, policyVersion: snapshot.policyVersion, scheduleId: snapshot.scheduleId, expectedEndAt: snapshot.expectedEndAt };
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
      const completed = snapshot?.calculationStatus === "completed" || snapshot?.calculationStatus === "disabled";
      const grossMinutes = completed ? Number(snapshot.grossMinutes || 0) : minutesBetween(row.clockInAt, row.clockOutAt || new Date().toISOString());
      const totalBreakMinutes = completed ? Number(snapshot.completedBreakMinutes || 0) : Number(breakByAttendance.get(String(row.id)) || 0);
      return {
        ...row,
        grossMinutes,
        totalBreakMinutes,
        totalWorkedMinutes: completed ? Number(snapshot.workedMinutes || 0) : Math.max(0, grossMinutes - totalBreakMinutes),
        scheduledShiftMinutes: snapshot ? Number(snapshot.scheduledMinutes || 0) : null,
        expectedEndAt: snapshot?.expectedEndAt || "",
        overtimeEnabled: snapshot ? Number(snapshot.overtimeEnabled || 0) === 1 : false,
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
