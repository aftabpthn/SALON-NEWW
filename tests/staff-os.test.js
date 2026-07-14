import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { db } from "../server/db.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function headers(role = "owner", tenantId = "tenant_aura", branchId = "") {
  return {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
    "x-user-role": role,
    ...(branchId ? { "x-branch-id": branchId } : {})
  };
}

async function api(baseUrl, path, { method = "GET", body, role = "owner", tenantId = "tenant_aura", branchId = "" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(role, tenantId, branchId),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

function ensureTenant(id, slug) {
  const now = new Date().toISOString();
  const plan = db.prepare("SELECT id FROM subscription_plans ORDER BY createdAt ASC LIMIT 1").get();
  db.prepare(`INSERT OR IGNORE INTO tenants (id, name, slug, status, planId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, `Tenant ${slug}`, slug, "active", plan?.id || null, now, now);
}

test("staff os core flow is tenant-safe, versioned and operational", async () => {
  ensureTenant("tenant_staff_os_other", "staff-os-other");
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const branchId = `branch_staff_os_${Date.now()}`;
  try {
    const created = await api(baseUrl, "/staff-os/staff", {
      method: "POST",
      body: {
        branchId,
        employeeCode: `EMP-${Date.now()}`,
        firstName: "Asha",
        lastName: "Kapoor",
        mobile: "+919999000001",
        designation: "Senior Stylist"
      },
      branchId
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.branchId, branchId);
    assert.equal(created.payload.version, 1);

    const leaked = await api(baseUrl, `/staff-os/staff/${created.payload.id}`, {
      tenantId: "tenant_staff_os_other",
      branchId
    });
    assert.equal(leaked.response.status, 404);

    const stale = await api(baseUrl, `/staff-os/staff/${created.payload.id}`, {
      method: "PATCH",
      body: { version: 0, designation: "Trainer" },
      branchId
    });
    assert.equal(stale.response.status, 409);

    const updated = await api(baseUrl, `/staff-os/staff/${created.payload.id}`, {
      method: "PATCH",
      body: { version: created.payload.version, designation: "Trainer" },
      branchId
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.version, 2);

    const backup = await api(baseUrl, "/staff-os/staff", {
      method: "POST",
      body: { branchId, firstName: "Rehan", lastName: "Ali", employeeCode: `EMP-B-${Date.now()}` },
      branchId
    });
    assert.equal(backup.response.status, 201);

    const schedule = await api(baseUrl, "/staff-os/schedules", {
      method: "POST",
      body: { branchId, staffId: created.payload.id, scheduleDate: "2026-06-10", startTime: "10:00", endTime: "19:00" },
      branchId
    });
    assert.equal(schedule.response.status, 201);
    assert.equal(schedule.payload.staffId, created.payload.id);

    const scheduleConflict = await api(baseUrl, `/staff-os/schedules/${schedule.payload.id}`, {
      method: "PATCH",
      body: { version: 99, startTime: "11:00" },
      branchId
    });
    assert.equal(scheduleConflict.response.status, 409);

    const swap = await api(baseUrl, "/staff-os/shift-swaps", {
      method: "POST",
      body: { scheduleId: schedule.payload.id, toStaffId: backup.payload.id, reason: "Roster balancing" },
      branchId
    });
    assert.equal(swap.response.status, 201);

    const approvedSwap = await api(baseUrl, `/staff-os/shift-swaps/${swap.payload.id}/approve`, {
      method: "POST",
      body: { version: swap.payload.version },
      branchId
    });
    assert.equal(approvedSwap.response.status, 200);
    assert.equal(approvedSwap.payload.status, "approved");

    const attendanceSchedule = await api(baseUrl, "/staff-os/schedules", {
      method: "POST",
      body: { branchId, staffId: created.payload.id, scheduleDate: "2026-06-10", startTime: "10:00", endTime: "19:00" },
      branchId
    });
    assert.equal(attendanceSchedule.response.status, 201);

    const attendance = await api(baseUrl, "/staff-os/attendance/clock-in", {
      method: "POST",
      body: { branchId, staffId: created.payload.id, businessDate: "2026-06-10", clockInAt: "2026-06-10T04:30:00.000Z", source: "manual" },
      branchId
    });
    assert.equal(attendance.response.status, 201);
    assert.equal(attendance.payload.status, "clocked_in");

    const breakStart = await api(baseUrl, "/staff-os/attendance/break-start", {
      method: "POST",
      body: { staffId: created.payload.id, startedAt: "2026-06-10T06:30:00.000Z" },
      branchId
    });
    assert.equal(breakStart.response.status, 201);

    const breakEnd = await api(baseUrl, "/staff-os/attendance/break-end", {
      method: "POST",
      body: { breakId: breakStart.payload.id, endedAt: "2026-06-10T07:00:00.000Z" },
      branchId
    });
    assert.equal(breakEnd.response.status, 200);
    assert.equal(breakEnd.payload.status, "ended");

    const clockOut = await api(baseUrl, "/staff-os/attendance/clock-out", {
      method: "POST",
      body: { staffId: created.payload.id, clockOutAt: "2026-06-10T14:30:00.000Z", overtimeMinutes: 45 },
      branchId
    });
    assert.equal(clockOut.response.status, 200);
    assert.equal(clockOut.payload.status, "clocked_out");
    assert.equal(clockOut.payload.overtimeMinutes, 30);
    assert.equal(clockOut.payload.totalBreakMinutes, 30);
    assert.equal(clockOut.payload.totalWorkedMinutes, 570);
    assert.equal(clockOut.payload.scheduledShiftMinutes, 540);

    const attendanceList = await api(baseUrl, `/staff-os/attendance?staffId=${created.payload.id}&from=2026-06-10&to=2026-06-10`, { branchId });
    assert.equal(attendanceList.response.status, 200);
    assert.equal(attendanceList.payload[0].overtimeCalculationStatus, "completed");

    const overtimeSummary = await api(baseUrl, `/staff-os/attendance/overtime-summary?staffId=${created.payload.id}&asOf=2026-06-10`, { branchId });
    assert.equal(overtimeSummary.response.status, 200);
    assert.equal(overtimeSummary.payload.todayMinutes, 30);
    assert.equal(overtimeSummary.payload.weekMinutes, 30);
    assert.equal(overtimeSummary.payload.last30DaysMinutes, 30);
    assert.equal(overtimeSummary.payload.lifetimeMinutes, 30);

    const historicalId = `att_historical_${Date.now()}`;
    db.prepare(`INSERT INTO staff_attendance_logs
      (id, tenant_id, branch_id, staff_id, business_date, clock_in_at, status, overtime_minutes)
      VALUES (@id, @tenantId, @branchId, @staffId, @businessDate, @clockInAt, 'clocked_in', @overtimeMinutes)`).run({
        id: historicalId,
        tenantId: "tenant_aura",
        branchId,
        staffId: created.payload.id,
        businessDate: "2026-06-09",
        clockInAt: "2026-06-09T04:30:00.000Z",
        overtimeMinutes: 17
      });
    const historicalClockOut = await api(baseUrl, "/staff-os/attendance/clock-out", {
      method: "POST",
      body: { staffId: created.payload.id, attendanceId: historicalId, clockOutAt: "2026-06-09T13:30:00.000Z", overtimeMinutes: 999 },
      branchId
    });
    assert.equal(historicalClockOut.response.status, 200);
    assert.equal(historicalClockOut.payload.overtimeMinutes, 17);
    assert.equal(historicalClockOut.payload.overtimeCalculationStatus, "legacy");

    const correction = await api(baseUrl, "/staff-os/attendance/correction", {
      method: "POST",
      body: { attendanceId: attendance.payload.id, reason: "Manager correction", patch: { overtimeMinutes: 45 } },
      branchId
    });
    assert.equal(correction.response.status, 201);
    assert.equal(correction.payload.status, "approved");

    const leave = await api(baseUrl, "/staff-os/leaves", {
      method: "POST",
      body: { branchId, staffId: created.payload.id, leaveType: "casual", startDate: "2026-06-12", endDate: "2026-06-12", reason: "Personal" },
      branchId
    });
    assert.equal(leave.response.status, 201);
    assert.equal(leave.payload.status, "pending");

    const approvedLeave = await api(baseUrl, `/staff-os/leaves/${leave.payload.id}/approve`, {
      method: "PATCH",
      body: { version: leave.payload.version },
      branchId
    });
    assert.equal(approvedLeave.response.status, 200);
    assert.equal(approvedLeave.payload.status, "approved");

    const payroll = await api(baseUrl, "/staff-os/payroll/generate", {
      method: "POST",
      body: { branchId, periodStart: "2026-06-01", periodEnd: "2026-06-30", defaultGrossAmount: 40000 },
      branchId
    });
    assert.equal(payroll.response.status, 201);
    assert.ok(payroll.payload.items.length >= 2);
    assert.ok(payroll.payload.netAmount > 0);

    const payrollApproval = await api(baseUrl, `/staff-os/payroll/${payroll.payload.id}/approve`, {
      method: "POST",
      branchId
    });
    assert.equal(payrollApproval.response.status, 200);
    assert.equal(payrollApproval.payload.status, "approved");

    const commission = await api(baseUrl, "/staff-os/commissions/calculate", {
      method: "POST",
      body: { branchId, staffId: created.payload.id, baseAmount: 10000, rate: 12 },
      branchId
    });
    assert.equal(commission.response.status, 201);
    assert.equal(commission.payload.commissionAmount, 1200);

    const commissionApproval = await api(baseUrl, `/staff-os/commissions/${commission.payload.id}/approve`, {
      method: "POST",
      branchId
    });
    assert.equal(commissionApproval.response.status, 200);
    assert.equal(commissionApproval.payload.status, "approved");

    const task = await api(baseUrl, "/staff-os/tasks", {
      method: "POST",
      body: { branchId, staffId: created.payload.id, title: "Sanitize premium bay", priority: "high" },
      branchId
    });
    assert.equal(task.response.status, 201);

    const risks = await api(baseUrl, "/staff-os/intelligence/burnout-risk", { branchId });
    assert.equal(risks.response.status, 200);
    assert.ok(Array.isArray(risks.payload));

    const audit = await api(baseUrl, "/staff-os/audit", { branchId });
    assert.equal(audit.response.status, 200);
    assert.ok(audit.payload.some((row) => row.action === "staff.payroll_generated"));
  } finally {
    await close(server);
  }
});

test("staff os role restrictions block payroll and attendance correction", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const branchId = `branch_staff_os_restrict_${Date.now()}`;
  try {
    const created = await api(baseUrl, "/staff-os/staff", {
      method: "POST",
      body: { branchId, firstName: "Nisha", employeeCode: `EMP-R-${Date.now()}` },
      branchId
    });
    assert.equal(created.response.status, 201);

    const payrollDenied = await api(baseUrl, "/staff-os/payroll/generate", {
      method: "POST",
      role: "staff",
      body: { branchId, periodStart: "2026-07-01", periodEnd: "2026-07-31" },
      branchId
    });
    assert.equal(payrollDenied.response.status, 403);

    const attendance = await api(baseUrl, "/staff-os/attendance/clock-in", {
      method: "POST",
      body: { branchId, staffId: created.payload.id, businessDate: "2026-07-01" },
      branchId
    });
    assert.equal(attendance.response.status, 201);

    const correctionDenied = await api(baseUrl, "/staff-os/attendance/correction", {
      method: "POST",
      role: "staff",
      body: { attendanceId: attendance.payload.id, reason: "try" },
      branchId
    });
    assert.equal(correctionDenied.response.status, 403);
  } finally {
    await close(server);
  }
});
