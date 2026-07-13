import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { calculateOvertime, matchSchedule, staffOvertimeService } from "./staff-overtime.service.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const pct = (value) => Math.round((Number(value) || 0) * 100) / 100;
const inactiveStaffStatuses = new Set(["archived", "blocked", "deleted", "inactive", "suspended", "terminated"]);

function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {}, "");
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function withinPeriod(row, start, end, field = "createdAt") {
  const key = String(row[field] || row.date || "").slice(0, 10);
  return (!start || key >= start) && (!end || key <= end);
}

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = String(start).split(":").map(Number);
  const [endHour, endMinute] = String(end).split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some((item) => Number.isNaN(item))) return 0;
  return Math.max(0, endHour * 60 + endMinute - (startHour * 60 + startMinute));
}

function appointmentMinutes(appointment) {
  const start = new Date(appointment.startAt).getTime();
  const end = new Date(appointment.endAt || appointment.startAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function rate(part, whole) {
  return whole ? pct((Number(part) / Number(whole)) * 100) : 0;
}

function sum(items, selector) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function isActiveStaff(person = {}) {
  return !inactiveStaffStatuses.has(String(person.status || "active").trim().toLowerCase());
}

function defaultPeriod(input = {}) {
  const periodEnd = input.periodEnd || now().slice(0, 10);
  const date = new Date(periodEnd);
  date.setDate(date.getDate() - 29);
  return { periodStart: input.periodStart || date.toISOString().slice(0, 10), periodEnd };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class SmartStaffService {
  context(input = {}, access) {
    tenantService.ensureSubscriptionActive(access.tenantId);
    const branchId = input.branchId || access.requestedBranchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const { periodStart, periodEnd } = defaultPeriod(input);
    const queryScope = scope(access, branchId);
    const branchQuery = branchId ? { branchId, limit: 10000 } : { limit: 10000 };
    const staff = repositories.staff.list(branchQuery, queryScope).filter(isActiveStaff);
    const sales = repositories.sales.list(branchQuery, queryScope).filter((sale) => withinPeriod(sale, periodStart, periodEnd));
    const appointments = repositories.appointments.list(branchQuery, queryScope).filter((appointment) => withinPeriod(appointment, periodStart, periodEnd, "startAt"));
    const attendance = repositories.staffAttendance.list(branchQuery, queryScope).filter((row) => withinPeriod(row, periodStart, periodEnd, "date"));
    const shifts = repositories.staffShifts.list(branchQuery, queryScope).filter((row) => withinPeriod(row, periodStart, periodEnd, "date"));
    const services = repositories.services.list({ limit: 10000 }, scope(access));
    return { access, branchId, periodStart, periodEnd, staff, sales, appointments, attendance, shifts, services };
  }

  summary(input = {}, access) {
    const context = this.context(input, access);
    const ranking = this.performanceRanking(context);
    const commission = this.calculateCommission(context);
    const incentives = this.calculateIncentivesFrom(context, ranking, commission.entries);
    const attendanceSummary = this.attendanceSummary(context);
    const payrollPreview = this.payrollRows(context, ranking, commission.entries, incentives.rows);
    const directory = this.staffDirectory(context, ranking, commission.entries, incentives.rows);
    return {
      periodStart: context.periodStart,
      periodEnd: context.periodEnd,
      branchId: context.branchId,
      metrics: {
        staffCount: context.staff.length,
        scheduledShifts: context.shifts.length,
        presentDays: attendanceSummary.presentDays,
        totalRevenue: money(sum(context.sales, (sale) => sale.total)),
        totalCommission: money(sum(commission.entries, (entry) => entry.commission)),
        totalIncentives: money(sum(incentives.rows, (row) => row.incentive)),
        averageScore: ranking.length ? pct(sum(ranking, (row) => row.performanceScore) / ranking.length) : 0
      },
      ranking,
      attendance: attendanceSummary,
      shifts: context.shifts,
      commission,
      incentives,
      payrollPreview,
      directory,
      integrationHealth: this.integrationHealth(context, commission.entries, incentives.rows, payrollPreview),
      insights: this.insights(ranking, attendanceSummary, incentives.rows)
    };
  }

  recordAttendance(payload, access) {
    const staff = this.requireStaff(payload.staffId, access);
    const branchId = payload.branchId || staff.branchId;
    tenantService.assertBranchAccess(access, branchId);
    const date = payload.date || now().slice(0, 10);
    const existing = repositories.staffAttendance
      .list({ branchId, limit: 10000 }, scope(access, branchId))
      .find((row) => row.staffId === staff.id && row.date === date);
    const schedules = repositories.staffShifts
      .list({ branchId, limit: 10000 }, scope(access, branchId))
      .filter((row) => row.staffId === staff.id && row.date === date);
    const clockIn = payload.clockIn || existing?.clockIn || "";
    const clockOut = payload.clockOut || existing?.clockOut || "";
    const completedBreakMinutes = Number(payload.completedBreakMinutes ?? payload.breakMinutes ?? 0);
    const grossMinutes = Number(payload.minutesWorked ?? (clockIn && clockOut ? minutesBetween(clockIn, clockOut) : existing?.minutesWorked || 0));
    const snapshot = existing ? staffOvertimeService.snapshot(access.tenantId, "staff_attendance", existing.id) : null;
    const matched = existing ? null : matchSchedule(schedules, { businessDate: date, clockInAt: clockIn });
    const hasSchedule = Boolean(snapshot?.scheduleId || matched?.schedule?.id);
    const scheduledShiftMinutes = Number(snapshot?.scheduledMinutes ?? matched?.scheduledMinutes ?? 0);
    const calculation = clockOut ? calculateOvertime({ grossMinutes, completedBreakMinutes, scheduledShiftMinutes, hasSchedule }) : null;
    const minutesWorked = calculation?.workedMinutes ?? grossMinutes;
    const overtimeMinutes = existing && !snapshot
      ? Number(existing.overtimeMinutes || 0)
      : Number(calculation?.overtimeMinutes || 0);
    const record = {
      branchId,
      staffId: staff.id,
      date,
      status: payload.status || existing?.status || "present",
      clockIn,
      clockOut,
      minutesWorked,
      overtimeMinutes,
      notes: payload.notes ?? existing?.notes ?? ""
    };
    const saved = db.transaction(() => {
      const result = existing
        ? repositories.staffAttendance.update(existing.id, record, scope(access, branchId))
        : repositories.staffAttendance.create({ id: makeId("att"), ...record }, scope(access, branchId));
      if (!existing) {
        staffOvertimeService.registerAttendance({
          tenantId: access.tenantId,
          branchId,
          staffId: staff.id,
          attendanceId: result.id,
          businessDate: date,
          clockInAt: clockIn,
          attendanceSource: "staff_attendance",
          schedules
        });
      }
      if (clockOut && (!existing || snapshot)) {
        staffOvertimeService.completeSnapshot({
          tenantId: access.tenantId,
          attendanceSource: "staff_attendance",
          attendanceId: result.id,
          clockInAt: clockIn,
          clockOutAt: clockOut,
          completedBreakMinutes
        });
      }
      return result;
    })();
    this.syncStaffAttendance(staff, saved, access);
    tenantService.recordUsage({ tenantId: access.tenantId, metric: "staff:attendance", referenceType: "staff_attendance", referenceId: saved.id });
    return saved;
  }

  planShift(payload, access) {
    const staff = this.requireStaff(payload.staffId, access);
    const branchId = payload.branchId || staff.branchId;
    tenantService.assertBranchAccess(access, branchId);
    if (!payload.date || !payload.startTime || !payload.endTime) throw badRequest("date, startTime and endTime are required");
    const shift = repositories.staffShifts.create({
      id: makeId("shift"),
      branchId,
      staffId: staff.id,
      date: payload.date,
      startTime: payload.startTime,
      endTime: payload.endTime,
      role: payload.role || staff.role,
      chair: payload.chair || "",
      serviceIds: payload.serviceIds || staff.assignedServices || [],
      status: payload.status || "planned",
      notes: payload.notes || ""
    }, scope(access, branchId));
    repositories.staff.update(staff.id, { shift: `${payload.startTime}-${payload.endTime}` }, scope(access));
    return shift;
  }

  runCommission(input = {}, access) {
    const context = this.context(input, access);
    const commission = this.calculateCommission(context);
    const run = repositories.staffCommissionRuns.create({
      id: makeId("comm"),
      branchId: context.branchId,
      periodStart: context.periodStart,
      periodEnd: context.periodEnd,
      summary: commission.summary,
      entries: commission.entries,
      status: "calculated"
    }, scope(access, context.branchId));
    tenantService.recordUsage({ tenantId: access.tenantId, metric: "staff:commission-run", referenceType: "staff_commission_run", referenceId: run.id });
    return { run, ...commission };
  }

  calculateIncentives(input = {}, access) {
    const context = this.context(input, access);
    const ranking = this.performanceRanking(context);
    const commission = this.calculateCommission(context);
    return this.calculateIncentivesFrom(context, ranking, commission.entries);
  }

  exportPayroll(input = {}, access) {
    const context = this.context(input, access);
    const ranking = this.performanceRanking(context);
    const commission = this.calculateCommission(context);
    const incentives = this.calculateIncentivesFrom(context, ranking, commission.entries);
    const rows = this.payrollRows(context, ranking, commission.entries, incentives.rows);
    const totals = {
      grossPayout: money(sum(rows, (row) => row.grossPayout)),
      commission: money(sum(rows, (row) => row.commission)),
      incentives: money(sum(rows, (row) => row.incentive)),
      overtimePay: money(sum(rows, (row) => row.overtimePay))
    };
    const header = ["staffId", "name", "branchId", "presentDays", "minutesWorked", "revenue", "commission", "incentive", "overtimePay", "grossPayout"];
    const csv = [header.join(","), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(","))].join("\n");
    const exportRecord = repositories.payrollExports.create({
      id: makeId("payroll"),
      branchId: context.branchId,
      periodStart: context.periodStart,
      periodEnd: context.periodEnd,
      format: input.format || "csv",
      rows,
      totals,
      status: "ready"
    }, scope(access, context.branchId));
    return { export: exportRecord, csv };
  }

  performance(input = {}, access) {
    return this.performanceRanking(this.context(input, access));
  }

  latestRuns(query = {}, access) {
    return {
      commissionRuns: repositories.staffCommissionRuns.list(query, scope(access)),
      payrollExports: repositories.payrollExports.list(query, scope(access))
    };
  }

  staffDirectory({ staff, services }, ranking, commissionEntries, incentiveRows) {
    const rankingByStaff = new Map(ranking.map((row) => [row.staffId, row]));
    const servicesByStaff = new Map();
    for (const service of services) {
      const assigned = Array.isArray(service.assignedStaff) ? service.assignedStaff : [];
      for (const staffId of assigned) {
        servicesByStaff.set(staffId, (servicesByStaff.get(staffId) || 0) + 1);
      }
    }
    return staff.map((person) => {
      const rankingRow = rankingByStaff.get(person.id) || {};
      const assignedServices = Array.isArray(person.assignedServices) ? person.assignedServices.length : Number(servicesByStaff.get(person.id) || 0);
      return {
        id: person.id,
        name: person.name,
        shortName: person.shortName || person.code || "",
        role: person.role || person.designation || "Staff",
        category: person.category || "",
        designation: person.designation || "",
        branchId: person.branchId || "",
        status: person.status || "active",
        phone: person.phone || person.mobile || person.contact || "",
        email: person.email || "",
        shift: person.shift || "",
        assignedServices,
        revenue: money(rankingRow.revenue),
        bookings: Number(rankingRow.bookings || 0),
        completed: Number(rankingRow.completed || 0),
        presentDays: Number(rankingRow.presentDays || 0),
        scheduledShifts: Number(rankingRow.scheduledShifts || 0),
        minutesWorked: Number(rankingRow.minutesWorked || 0),
        overtimeMinutes: Number(rankingRow.overtimeMinutes || 0),
        serviceEfficiency: pct(rankingRow.serviceEfficiency),
        attendanceScore: pct(rankingRow.attendanceScore),
        performanceScore: pct(rankingRow.performanceScore),
        commission: money(sum(commissionEntries.filter((entry) => entry.staffId === person.id), (entry) => entry.commission)),
        incentive: money(incentiveRows.find((row) => row.staffId === person.id)?.incentive || 0)
      };
    }).sort((a, b) => b.performanceScore - a.performanceScore || a.name.localeCompare(b.name));
  }

  integrationHealth({ staff, sales, appointments, attendance, shifts, services }, commissionEntries, incentiveRows, payrollPreview) {
    return [
      { key: "employee-masters", label: "Employee masters", count: staff.length, source: "staff", status: "connected" },
      { key: "attendance", label: "Attendance records", count: attendance.length, source: "staff_attendance", status: "connected" },
      { key: "shift", label: "Planned shifts", count: shifts.length, source: "staff_shifts", status: "connected" },
      { key: "appointments", label: "Staff bookings", count: appointments.length, source: "appointments", status: "connected" },
      { key: "pos", label: "Staff sales", count: sales.length, source: "sales", status: "connected" },
      { key: "services", label: "Service catalog", count: services.length, source: "services", status: "connected" },
      { key: "commission", label: "Commission lines", count: commissionEntries.length, source: "sales", status: "connected" },
      { key: "incentives", label: "Incentive rows", count: incentiveRows.length, source: "smart_staff", status: "connected" },
      { key: "payroll", label: "Payroll preview rows", count: payrollPreview.length, source: "staff_payroll", status: "connected" }
    ];
  }

  requireStaff(staffId, access) {
    if (!staffId) throw badRequest("staffId is required");
    const staff = repositories.staff.getById(staffId, scope(access));
    if (!staff) throw notFound("Staff member not found");
    tenantService.assertBranchAccess(access, staff.branchId);
    return staff;
  }

  syncStaffAttendance(staff, attendanceRecord, access) {
    const attendance = Array.isArray(staff.attendance) ? staff.attendance.filter((row) => row.date !== attendanceRecord.date) : [];
    repositories.staff.update(staff.id, {
      attendance: [
        {
          date: attendanceRecord.date,
          status: attendanceRecord.status,
          clockIn: attendanceRecord.clockIn,
          clockOut: attendanceRecord.clockOut,
          minutesWorked: attendanceRecord.minutesWorked
        },
        ...attendance
      ].slice(0, 90)
    }, scope(access));
  }

  calculateCommission({ staff, sales }) {
    const entries = [];
    const revenueByStaff = new Map();
    for (const sale of sales) {
      revenueByStaff.set(sale.staffId || "", money((revenueByStaff.get(sale.staffId || "") || 0) + Number(sale.total || 0)));
    }
    const staffById = new Map(staff.map((person) => [person.id, person]));
    for (const sale of sales) {
      const person = staffById.get(sale.staffId);
      if (!person) continue;
      const rule = person.commissionRule || {};
      for (const item of sale.items || []) {
        const line = Number(item.price || 0) * Number(item.quantity || 1);
        const basePercent = item.type === "product" ? Number(rule.retailPercent || 0) : Number(rule.servicePercent || 0);
        const tierBonus = this.tierBonus(rule, revenueByStaff.get(person.id) || 0);
        const efficiencyBonus = Number(person.performance?.rating || 0) >= 4.8 ? 0.5 : 0;
        const percent = basePercent + tierBonus + efficiencyBonus;
        entries.push({
          staffId: person.id,
          staffName: person.name,
          saleId: sale.id,
          itemType: item.type,
          itemName: item.name,
          lineAmount: money(line),
          percent: pct(percent),
          commission: money((line * percent) / 100),
          createdAt: sale.createdAt
        });
      }
    }
    return {
      summary: {
        staffCount: staff.length,
        entryCount: entries.length,
        totalCommission: money(sum(entries, (entry) => entry.commission))
      },
      entries
    };
  }

  tierBonus(rule, revenue) {
    const tiers = Array.isArray(rule.tiers) && rule.tiers.length
      ? rule.tiers
      : [
          { threshold: 50000, bonusPercent: 1.5 },
          { threshold: 100000, bonusPercent: 3 }
        ];
    return Number([...tiers].sort((a, b) => Number(b.threshold) - Number(a.threshold)).find((tier) => revenue >= Number(tier.threshold))?.bonusPercent || 0);
  }

  performanceRanking({ staff, sales, appointments, attendance, shifts, services }) {
    const serviceById = new Map(services.map((service) => [service.id, service]));
    return staff.map((person) => {
      const staffSales = sales.filter((sale) => sale.staffId === person.id);
      const staffAppointments = appointments.filter((appointment) => appointment.staffId === person.id);
      const completed = staffAppointments.filter((appointment) => appointment.status === "completed").length;
      const noShows = staffAppointments.filter((appointment) => appointment.status === "no-show").length;
      const staffAttendance = attendance.filter((row) => row.staffId === person.id);
      const staffShifts = shifts.filter((row) => row.staffId === person.id);
      const present = staffAttendance.filter((row) => row.status === "present").length;
      const expectedMinutes = sum(staffAppointments, (appointment) =>
        (appointment.serviceIds || []).reduce((total, serviceId) => total + Number(serviceById.get(serviceId)?.durationMinutes || 0), 0)
      );
      const actualMinutes = sum(staffAppointments, appointmentMinutes);
      const revenue = money(sum(staffSales, (sale) => sale.total));
      const retailRevenue = money(sum(staffSales.flatMap((sale) => sale.items || []), (item) => item.type === "product" ? Number(item.price || 0) * Number(item.quantity || 1) : 0));
      const attendanceScore = staffShifts.length ? rate(present, staffShifts.length) : rate(present, Math.max(1, staffAttendance.length));
      const completionRate = rate(completed, staffAppointments.length);
      const efficiency = actualMinutes ? pct(Math.min(125, (expectedMinutes / actualMinutes) * 100)) : completionRate;
      const noShowPenalty = rate(noShows, staffAppointments.length) * 0.2;
      const rating = Number(person.performance?.rating || 4.2);
      const performanceScore = pct(Math.min(100, revenue / 650 + completionRate * 0.28 + attendanceScore * 0.24 + efficiency * 0.18 + rating * 5 - noShowPenalty));
      return {
        staffId: person.id,
        name: person.name,
        role: person.role,
        branchId: person.branchId,
        revenue,
        retailRevenue,
        bookings: staffAppointments.length,
        completed,
        completionRate,
        noShows,
        presentDays: present,
        scheduledShifts: staffShifts.length,
        minutesWorked: sum(staffAttendance, (row) => row.minutesWorked),
        overtimeMinutes: sum(staffAttendance, (row) => row.overtimeMinutes),
        serviceEfficiency: efficiency,
        attendanceScore,
        rating,
        performanceScore
      };
    }).sort((a, b) => b.performanceScore - a.performanceScore);
  }

  attendanceSummary({ attendance, shifts }) {
    return {
      records: attendance,
      scheduledShifts: shifts.length,
      presentDays: attendance.filter((row) => row.status === "present").length,
      absentDays: attendance.filter((row) => row.status === "absent").length,
      lateMarks: attendance.filter((row) => row.status === "late").length,
      totalMinutes: sum(attendance, (row) => row.minutesWorked),
      overtimeMinutes: sum(attendance, (row) => row.overtimeMinutes)
    };
  }

  calculateIncentivesFrom(_context, ranking, commissionEntries) {
    const rows = ranking.map((person) => {
      const commission = money(sum(commissionEntries.filter((entry) => entry.staffId === person.staffId), (entry) => entry.commission));
      const performanceBonus = person.performanceScore >= 90 ? 2000 : person.performanceScore >= 80 ? 1000 : person.performanceScore >= 70 ? 500 : 0;
      const retailBonus = person.retailRevenue >= 10000 ? 750 : person.retailRevenue >= 5000 ? 350 : 0;
      const attendanceBonus = person.attendanceScore >= 95 ? 500 : 0;
      const incentive = money(performanceBonus + retailBonus + attendanceBonus);
      return {
        staffId: person.staffId,
        name: person.name,
        branchId: person.branchId,
        commission,
        incentive,
        reason: [performanceBonus ? "performance" : "", retailBonus ? "retail upsell" : "", attendanceBonus ? "attendance" : ""].filter(Boolean).join(", ") || "No incentive threshold met"
      };
    });
    return { rows, total: money(sum(rows, (row) => row.incentive)) };
  }

  payrollRows(_context, ranking, commissionEntries, incentives) {
    return ranking.map((person) => {
      const commission = money(sum(commissionEntries.filter((entry) => entry.staffId === person.staffId), (entry) => entry.commission));
      const incentive = money(incentives.find((row) => row.staffId === person.staffId)?.incentive || 0);
      const overtimePay = money(Number(person.overtimeMinutes || 0) * 2);
      return {
        staffId: person.staffId,
        name: person.name,
        role: person.role,
        branchId: person.branchId,
        presentDays: person.presentDays,
        minutesWorked: person.minutesWorked,
        revenue: person.revenue,
        commission,
        incentive,
        overtimePay,
        grossPayout: money(commission + incentive + overtimePay)
      };
    });
  }

  insights(ranking, attendance, incentives) {
    const insights = [];
    const top = ranking[0];
    if (top) insights.push(`${top.name} is leading performance with score ${top.performanceScore} and INR ${top.revenue} revenue.`);
    const efficiencyLeader = [...ranking].sort((a, b) => b.serviceEfficiency - a.serviceEfficiency)[0];
    if (efficiencyLeader) insights.push(`${efficiencyLeader.name} has the strongest service efficiency at ${efficiencyLeader.serviceEfficiency}%.`);
    if (attendance.absentDays || attendance.lateMarks) insights.push(`${attendance.absentDays} absences and ${attendance.lateMarks} late marks need shift planner attention.`);
    const topIncentive = [...incentives].sort((a, b) => b.incentive - a.incentive)[0];
    if (topIncentive?.incentive) insights.push(`${topIncentive.name} qualifies for INR ${topIncentive.incentive} incentive due to ${topIncentive.reason}.`);
    if (!insights.length) insights.push("Staff operations are stable for the selected period.");
    return insights;
  }
}

export const smartStaffService = new SmartStaffService();
