import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, conflict, notFound } from "../utils/app-error.js";
import { appointmentActivityService, APPOINTMENT_ACTIVITY_ACTIONS } from "./appointment-activity.service.js";
import { appointmentSmsService } from "./appointment-sms.service.js";
import { ensureEnterpriseSchedulerSchema } from "./enterprise-scheduler-schema.service.js";
import { resourceService } from "./resource.service.js";
import { securityService } from "./security.service.js";
import { smartBookingService } from "./smart-booking.service.js";
import { staffOsService } from "./staff-os.service.js";
import { tenantService } from "./tenant.service.js";

const ACTIVE_STAFF_STATUSES = new Set(["", "active", "available", "on-roll", "onroll", "probation"]);
const INACTIVE_APPOINTMENT_STATUSES = new Set(["cancelled", "canceled", "no-show", "deleted"]);

function id(prefix) {
  return `${prefix}_${randomUUID().slice(0, 10)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = text ? new Date(text) : new Date();
  return Number.isNaN(date.getTime()) ? today() : date.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoAt(dateText, timeText) {
  const time = normalizeTime(timeText);
  return new Date(`${dateText}T${time}:00.000Z`).toISOString();
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (/^\d{2}:\d{2}$/.test(text)) return text;
  if (/^\d{1}:\d{2}$/.test(text)) return `0${text}`;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(11, 16);
  return "";
}

function minutesBetween(start, end) {
  const value = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function addMinutes(value, minutes) {
  return new Date(new Date(value).getTime() + Number(minutes || 0) * 60000).toISOString();
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime()
    && new Date(aEnd).getTime() > new Date(bStart).getTime();
}

function tableExists(table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function camelSchedule(row = {}) {
  return {
    id: row.id,
    branchId: row.branch_id,
    staffId: row.staff_id,
    scheduleDate: row.schedule_date,
    startTime: row.start_time,
    endTime: row.end_time,
    shiftType: row.shift_type || "regular",
    status: row.status || "scheduled",
    notes: row.notes || ""
  };
}

function normalizeStaff(row = {}, source = "staff") {
  if (source === "staff_os") {
    const fullName = row.fullName || row.full_name || [row.firstName, row.lastName].filter(Boolean).join(" ");
    const displayName = fullName || row.name || row.employeeCode || row.employee_code || row.id;
    const role = row.designation || row.role || row.staffCategoryName || row.staff_category_name || row.department || "Staff";
    return {
      id: row.id,
      name: displayName,
      shortName: row.shortName || row.employeeCode || row.employee_code || initials(displayName),
      branchId: row.branchId || row.branch_id || "",
      role,
      status: row.status || "active",
      phone: row.mobile || row.phone || row.contact || "",
      avatar: row.profilePhoto || row.profile_photo || row.avatar || row.photoUrl || "",
      employeeCode: row.employeeCode || row.employee_code || "",
      staffCategoryName: row.staffCategoryName || row.staff_category_name || "",
      designation: row.designation || "",
      department: row.department || "",
      source
    };
  }
  if (source === "staff_master") {
    return {
      id: row.id,
      name: row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || row.employee_code || row.id,
      shortName: row.employee_code || initials(row.full_name || row.first_name || row.id),
      branchId: row.branch_id || "",
      role: row.designation || row.department || "Stylist",
      status: row.status || "active",
      phone: row.mobile || "",
      avatar: row.profile_photo || "",
      source
    };
  }
  return {
    id: row.id,
    name: row.name || row.fullName || row.shortName || row.id,
    shortName: row.shortName || row.code || initials(row.name || row.id),
    branchId: row.branchId || "",
    role: row.role || row.designation || "Stylist",
    status: row.status || "active",
    phone: row.phone || row.mobile || "",
    avatar: row.avatar || row.photoUrl || "",
    source
  };
}

function initials(value) {
  return String(value || "")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function activeStaff(row = {}) {
  return ACTIVE_STAFF_STATUSES.has(String(row.status || "").trim().toLowerCase());
}

function staffMatchesSearch(row = {}, search = "") {
  const text = String(search || "").trim().toLowerCase();
  if (!text) return true;
  return [
    row.name,
    row.shortName,
    row.role,
    row.phone,
    row.mobile,
    row.employeeCode,
    row.staffCategoryName,
    row.designation,
    row.department,
    row.id
  ].filter(Boolean).join(" ").toLowerCase().includes(text);
}

function branchFrom(query = {}, access = {}) {
  const requested = query.branchId || query.branch_id || access.branchId || "";
  if (requested) {
    tenantService.assertBranchAccess(access, requested);
    return requested;
  }
  const branch = repositories.branches.list({ limit: 1 }, { tenantId: access.tenantId })[0];
  return branch?.id || "";
}

function scopedQuery(access, branchId) {
  const scope = tenantService.accessScope(access, "appointments");
  if (branchId) scope.branchId = branchId;
  return scope;
}

function serviceDuration(serviceId, access) {
  const service = repositories.services.getById(serviceId, { tenantId: access.tenantId });
  return Math.max(15, Number(service?.durationMinutes || 30));
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function uniqueById(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.id || map.has(row.id)) continue;
    map.set(row.id, row);
  }
  return [...map.values()];
}

export class EnterpriseSchedulerService {
  context(query = {}, access = {}) {
    ensureEnterpriseSchedulerSchema();
    const branchId = branchFrom(query, access);
    if (!branchId) throw badRequest("branchId is required");
    const date = dateOnly(query.date || query.from);
    const from = dateOnly(query.from || date);
    const to = dateOnly(query.to || addDays(from, 1));
    const exclusiveTo = to <= from ? addDays(from, 1) : to;
    const staffLimit = Math.min(Math.max(safeNumber(query.staffLimit, 15), 1), 30);
    const staffOffset = Math.max(safeNumber(query.staffOffset, 0), 0);
    const staffFilter = String(query.staffId || "").trim();
    const staffSearch = String(query.staffSearch || query.q || "").trim().toLowerCase();
    const clientSearch = String(query.clientSearch || "").trim();
    const serviceSearch = String(query.serviceSearch || "").trim();
    const status = String(query.status || "").trim().toLowerCase();
    const clientLimit = Math.min(Math.max(safeNumber(query.clientLimit, 120), 25), 250);
    const serviceLimit = Math.min(Math.max(safeNumber(query.serviceLimit, 300), 50), 600);

    const allStaff = this.staff(branchId, access, staffSearch);
    const staffPool = staffFilter ? allStaff.filter((person) => person.id === staffFilter) : allStaff;
    const visibleStaff = staffPool.slice(staffOffset, staffOffset + staffLimit);
    const visibleStaffIds = new Set(visibleStaff.map((person) => person.id));
    const rangeQuery = { branchId, from, to: exclusiveTo, limit: 5000 };
    const rawAppointments = repositories.appointments
      .list(rangeQuery, scopedQuery(access, branchId))
      .filter((appointment) => !status || String(appointment.status || "").toLowerCase() === status);
    const sales = repositories.sales.list({ branchId, limit: 10000 }, scopedQuery(access, branchId));
    const saleIdsByAppointmentId = new Map();
    for (const sale of sales) {
      const appointmentId = String(sale.appointmentId || "");
      if (!appointmentId) continue;
      const rows = saleIdsByAppointmentId.get(appointmentId) || [];
      rows.push(String(sale.id || ""));
      saleIdsByAppointmentId.set(appointmentId, rows);
    }
    const billedAppointmentIds = new Set(
      repositories.invoices
        .list({ limit: 10000 }, scopedQuery(access, branchId))
        .filter((invoice) => String(invoice.status || "").trim().toLowerCase() !== "deleted")
        .flatMap((invoice) => {
          const directAppointmentId = String(invoice.appointmentId || "");
          if (directAppointmentId) return [directAppointmentId];
          const sale = sales.find((row) => String(row.id || "") === String(invoice.saleId || ""));
          return sale?.appointmentId ? [String(sale.appointmentId)] : [];
        })
        .filter(Boolean)
    );
    const billedBookingGroupIds = new Set(
      rawAppointments
        .filter((appointment) => billedAppointmentIds.has(String(appointment.id || "")))
        .map((appointment) => String(appointment.bookingGroupId || ""))
        .filter(Boolean)
    );
    const allAppointments = rawAppointments.map((appointment) => ({
      ...appointment,
      billingLocked: billedAppointmentIds.has(String(appointment.id || "")) || billedBookingGroupIds.has(String(appointment.bookingGroupId || "")),
      billedSaleIds: saleIdsByAppointmentId.get(String(appointment.id || "")) || []
    }));
    const appointments = allAppointments.filter((appointment) => !visibleStaffIds.size || visibleStaffIds.has(appointment.staffId || ""));
    const schedules = this.schedules(branchId, from, exclusiveTo, access).filter((row) => visibleStaffIds.has(row.staffId));
    const blockedTimes = this.blocks(branchId, from, exclusiveTo, access).filter((row) => visibleStaffIds.has(row.staffId));
    const waitlist = this.waitlist(branchId, from, exclusiveTo, access);
    const servicesForSummary = repositories.services.list({ limit: 1500 }, { tenantId: access.tenantId });
    const services = repositories.services.list({ q: serviceSearch, limit: serviceLimit }, { tenantId: access.tenantId });
    const clients = repositories.clients.list({ branchId, q: clientSearch, limit: clientLimit }, tenantService.accessScope(access, "clients"));
    const summary = this.summary({ appointments: allAppointments, visibleAppointments: appointments, schedules, blockedTimes, waitlist, staff: visibleStaff, services: servicesForSummary });

    return {
      branchId,
      date,
      from,
      to: exclusiveTo,
      staffWindow: {
        offset: staffOffset,
        limit: staffLimit,
        total: staffPool.length,
        showingFrom: staffPool.length ? staffOffset + 1 : 0,
        showingTo: Math.min(staffOffset + staffLimit, staffPool.length)
      },
      staff: visibleStaff,
      staffTotal: allStaff.length,
      appointments,
      appointmentTotal: allAppointments.length,
      clients,
      services,
      lookupLimits: { clients: clientLimit, services: serviceLimit },
      schedules,
      blockedTimes,
      waitlist,
      summary,
      actionQueue: this.actionQueue({ appointments: allAppointments, visibleAppointments: appointments, schedules, blockedTimes, waitlist, staff: visibleStaff, services: servicesForSummary, summary })
    };
  }

  appointmentBillingStatus(idValue, access = {}) {
    const appointmentId = String(idValue || "").trim();
    if (!appointmentId) throw badRequest("appointmentId is required");
    const appointment = repositories.appointments.getById(appointmentId, scopedQuery(access));
    if (!appointment) throw notFound("Appointment not found");
    const branchId = String(appointment.branchId || access.branchId || "");
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const bookingGroupId = String(appointment.bookingGroupId || "").trim();
    const groupAppointments = bookingGroupId
      ? repositories.appointments
        .list({ branchId, limit: 10000 }, scopedQuery(access, branchId))
        .filter((row) => String(row.bookingGroupId || "") === bookingGroupId)
      : [appointment];
    const appointmentIds = new Set(groupAppointments.map((row) => String(row.id || "")).filter(Boolean));
    const sales = repositories.sales.list(branchId ? { branchId, limit: 10000 } : { limit: 10000 }, scopedQuery(access, branchId));
    const saleIds = new Set(
      sales
        .filter((sale) => appointmentIds.has(String(sale.appointmentId || "")))
        .map((sale) => String(sale.id || ""))
    );
    const invoice = repositories.invoices
      .list({ limit: 10000 }, scopedQuery(access, branchId))
      .find((row) => {
        const status = String(row.status || "").trim().toLowerCase();
        if (status === "deleted") return false;
        return appointmentIds.has(String(row.appointmentId || "")) || saleIds.has(String(row.saleId || ""));
      });
    return {
      appointmentId,
      appointmentIds: [...appointmentIds],
      bookingGroupId,
      billed: !!invoice,
      invoiceId: String(invoice?.id || ""),
      invoiceNumber: String(invoice?.invoiceNumber || ""),
      status: String(invoice?.status || "")
    };
  }

  createBlockedTime(payload = {}, access = {}) {
    ensureEnterpriseSchedulerSchema();
    const branchId = payload.branchId || access.branchId || "";
    if (!branchId) throw badRequest("branchId is required");
    tenantService.assertBranchAccess(access, branchId);
    const staffId = String(payload.staffId || "").trim();
    const date = dateOnly(payload.date || payload.blockDate);
    const startTime = normalizeTime(payload.startTime || payload.startAt);
    const endTime = normalizeTime(payload.endTime || payload.endAt);
    if (!staffId) throw badRequest("staffId is required");
    if (!startTime || !endTime) throw badRequest("startTime and endTime are required");
    const startAt = isoAt(date, startTime);
    const endAt = isoAt(date, endTime);
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) throw badRequest("endTime must be after startTime");

    const busyAppointments = repositories.appointments
      .list({ branchId, from: date, to: addDays(date, 1), limit: 1000 }, scopedQuery(access, branchId))
      .filter((appointment) => appointment.staffId === staffId && !INACTIVE_APPOINTMENT_STATUSES.has(String(appointment.status || "").toLowerCase()))
      .filter((appointment) => overlaps(startAt, endAt, appointment.startAt, appointment.endAt || addMinutes(appointment.startAt, 30)));
    if (busyAppointments.length) throw conflict("Blocked time overlaps an appointment", { appointments: busyAppointments });

    const existingBlocks = this.blocks(branchId, date, addDays(date, 1), access)
      .filter((block) => block.staffId === staffId && overlaps(startAt, endAt, block.startAt, block.endAt));
    if (existingBlocks.length) throw conflict("Blocked time overlaps an existing blocked slot", { blocks: existingBlocks });

    const row = {
      id: id("blk"),
      tenantId: access.tenantId,
      branchId,
      staffId,
      blockDate: date,
      startAt,
      endAt,
      reason: String(payload.reason || "Blocked time").trim(),
      status: "blocked",
      createdBy: access.userId || ""
    };
    db.prepare(`INSERT INTO appointment_staff_blocks
      (id, tenantId, branchId, staffId, blockDate, startAt, endAt, reason, status, createdBy)
      VALUES (@id, @tenantId, @branchId, @staffId, @blockDate, @startAt, @endAt, @reason, @status, @createdBy)`).run(row);
    securityService.audit({
      action: "enterprise_scheduler.blocked_time_created",
      targetType: "appointment_staff_blocks",
      targetId: row.id,
      details: { branchId, staffId, startAt, endAt }
    }, access);
    return { blockedTime: this.blockById(row.id, access) };
  }

  removeBlockedTime(idValue, access = {}) {
    ensureEnterpriseSchedulerSchema();
    const existing = this.blockById(idValue, access);
    if (!existing) throw notFound("Blocked time not found");
    tenantService.assertBranchAccess(access, existing.branchId);
    db.prepare("DELETE FROM appointment_staff_blocks WHERE id = ? AND tenantId = ?").run(idValue, access.tenantId);
    securityService.audit({
      action: "enterprise_scheduler.blocked_time_removed",
      targetType: "appointment_staff_blocks",
      targetId: idValue,
      details: { branchId: existing.branchId, staffId: existing.staffId }
    }, access);
    return { deleted: true, blockedTime: existing };
  }

  createMultiServiceBooking(payload = {}, access = {}, req = null) {
    ensureEnterpriseSchedulerSchema();
    const branchId = payload.branchId || access.branchId || "";
    const clientId = String(payload.clientId || "").trim();
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!branchId) throw badRequest("branchId is required");
    if (!clientId) throw badRequest("clientId is required");
    if (!lines.length) throw badRequest("At least one service line is required");
    tenantService.assertBranchAccess(access, branchId);
    const bookingGroupId = id("grp");
    const preparedLines = lines.map((line, index) => {
      const serviceId = String(line.serviceId || "").trim();
      const staffId = String(line.staffId || "").trim();
      const startAt = line.startAt || (line.date && line.startTime ? isoAt(dateOnly(line.date), line.startTime) : "");
      if (!serviceId || !staffId || !startAt) throw badRequest(`Line ${index + 1} requires serviceId, staffId and start time`);
      const durationMinutes = Math.max(15, safeNumber(line.durationMinutes, serviceDuration(serviceId, access)));
      return {
        ...line,
        lineNumber: index + 1,
        serviceId,
        staffId,
        startAt: new Date(startAt).toISOString(),
        endAt: line.endAt ? new Date(line.endAt).toISOString() : addMinutes(startAt, durationMinutes),
        durationMinutes,
        chair: line.chair || payload.chair || "",
        room: line.room || payload.room || ""
      };
    });
    for (const line of preparedLines) {
      const conflicts = smartBookingService.findConflicts({
        branchId,
        staffId: line.staffId,
        chair: line.chair,
        startAt: line.startAt,
        endAt: line.endAt,
        access
      });
      if (conflicts.length) throw conflict("Appointment conflict detected", { conflicts });
    }
    for (let left = 0; left < preparedLines.length; left += 1) {
      for (let right = left + 1; right < preparedLines.length; right += 1) {
        const first = preparedLines[left];
        const second = preparedLines[right];
        const sameStaff = first.staffId && first.staffId === second.staffId;
        const sameChair = first.chair && first.chair === second.chair;
        if ((sameStaff || sameChair) && overlaps(first.startAt, first.endAt, second.startAt, second.endAt)) {
          throw conflict("Appointment conflict detected", {
            conflicts: [{
              reason: sameStaff ? "staff-overlap" : "chair-overlap",
              lines: [first.lineNumber, second.lineNumber],
              staffId: sameStaff ? first.staffId : "",
              chair: sameChair ? first.chair : ""
            }]
          });
        }
      }
    }
    const created = [];
    const notifyTargets = Array.isArray(payload.notifyTargets) ? payload.notifyTargets : [];
    const transaction = db.transaction(() => {
      for (const [index, line] of preparedLines.entries()) {
        const appointment = resourceService.create("appointments", {
          clientId,
          branchId,
          staffId: line.staffId,
          serviceIds: [line.serviceId],
          startAt: line.startAt,
          endAt: line.endAt,
          status: payload.status || "booked",
          chair: line.chair,
          room: line.room,
          source: "enterprise-scheduler",
          sourceChannel: "front_desk",
          bookingGroupId,
          groupMemberRole: lines.length > 1 ? `service-${index + 1}` : "primary",
          notes: [payload.notes || "", line.notes || ""].filter(Boolean).join(" | ")
        }, access, {
          req,
          skipSchedulingConflictCheck: true,
          activityAction: lines.length > 1 ? APPOINTMENT_ACTIVITY_ACTIONS.GROUP_BOOKED || APPOINTMENT_ACTIVITY_ACTIONS.BOOKED : APPOINTMENT_ACTIVITY_ACTIONS.BOOKED
        });
        created.push(appointment);
      }
    });
    transaction();

    const smsResults = [];
    for (const appointment of created) {
      for (const target of notifyTargets) {
        if (!["client", "staff", "owner"].includes(target)) continue;
        try {
          smsResults.push(appointmentSmsService.queueAppointmentSms(appointment.id, { target }, access));
        } catch (error) {
          smsResults.push({ queued: false, target, appointmentId: appointment.id, error: error.message });
        }
      }
    }

    return { bookingGroupId, appointments: created, smsResults };
  }

  moveAppointment(idValue, payload = {}, access = {}, req = null) {
    ensureEnterpriseSchedulerSchema();
    const appointment = repositories.appointments.getById(idValue, { tenantId: access.tenantId });
    if (!appointment) throw notFound("Appointment not found");
    tenantService.assertBranchAccess(access, appointment.branchId || access.branchId || "");
    const startAt = payload.startAt || appointment.startAt;
    const endAt = payload.endAt || addMinutes(startAt, minutesBetween(appointment.startAt, appointment.endAt || addMinutes(appointment.startAt, 30)) || 30);
    const updated = resourceService.update("appointments", idValue, {
      branchId: payload.branchId || appointment.branchId,
      staffId: payload.staffId || appointment.staffId,
      startAt,
      endAt,
      chair: payload.chair ?? appointment.chair ?? "",
      room: payload.room ?? appointment.room ?? "",
      reason: payload.reason || "Enterprise scheduler move"
    }, access, { req, activityAction: APPOINTMENT_ACTIVITY_ACTIONS.RESCHEDULED });
    return { appointment: updated };
  }

  staff(branchId, access, search = "") {
    const rows = [];
    try {
      rows.push(...staffOsService
        .listStaff({ branchId, status: "active", limit: 200 }, access)
        .filter(activeStaff)
        .map((row) => normalizeStaff(row, "staff_os")));
    } catch (error) {
      console.warn("Appointment scheduler live staff source failed", error?.message || error);
    }
    if (!rows.length) {
      const legacy = repositories.staff
        .list({ branchId, limit: 5000 }, tenantService.accessScope(access, "staff"))
        .filter(activeStaff)
        .map((row) => normalizeStaff(row, "staff"));
      rows.push(...legacy);
      if (tableExists("staff_master")) {
        const masterRows = db.prepare(`SELECT * FROM staff_master
          WHERE tenant_id = @tenantId AND branch_id = @branchId AND lower(COALESCE(status, 'active')) IN ('active', 'available', 'on-roll', 'onroll', 'probation')
          ORDER BY full_name LIMIT 5000`).all({ tenantId: access.tenantId, branchId });
        rows.push(...masterRows.map((row) => normalizeStaff(row, "staff_master")));
      }
    }
    return uniqueById(rows)
      .filter((row) => staffMatchesSearch(row, search))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  schedules(branchId, from, to, access) {
    if (!tableExists("staff_schedules")) return [];
    return db.prepare(`SELECT * FROM staff_schedules
      WHERE tenant_id = @tenantId AND branch_id = @branchId AND schedule_date >= @from AND schedule_date < @to
        AND lower(COALESCE(status, 'scheduled')) != 'cancelled'
      ORDER BY schedule_date, start_time`).all({
        tenantId: access.tenantId,
        branchId,
        from,
        to
      }).map(camelSchedule);
  }

  blocks(branchId, from, to, access) {
    ensureEnterpriseSchedulerSchema();
    return db.prepare(`SELECT * FROM appointment_staff_blocks
      WHERE tenantId = @tenantId AND branchId = @branchId AND blockDate >= @from AND blockDate < @to
        AND status = 'blocked'
      ORDER BY blockDate, startAt`).all({ tenantId: access.tenantId, branchId, from, to });
  }

  blockById(idValue, access) {
    return db.prepare("SELECT * FROM appointment_staff_blocks WHERE id = ? AND tenantId = ?").get(idValue, access.tenantId);
  }

  waitlist(branchId, from, to, access) {
    return repositories.bookingWaitlist
      .list({ branchId, limit: 500 }, tenantService.accessScope(access, "bookingWaitlist"))
      .filter((row) => !row.preferredDate || (row.preferredDate >= from && row.preferredDate < to))
      .filter((row) => ["waiting", "pending", "open"].includes(String(row.status || "waiting").toLowerCase()));
  }

  summary({ appointments, visibleAppointments, schedules, blockedTimes, waitlist, staff, services }) {
    const serviceById = new Map(services.map((service) => [service.id, service]));
    const summaryAppointments = appointments.length ? appointments : visibleAppointments;
    const activeAppointments = summaryAppointments.filter((appointment) => {
      const status = String(appointment.status || "booked").toLowerCase();
      return !INACTIVE_APPOINTMENT_STATUSES.has(status);
    });
    const bookedMinutes = activeAppointments.reduce((sum, appointment) => {
      const explicit = minutesBetween(appointment.startAt, appointment.endAt || "");
      if (explicit) return sum + explicit;
      return sum + (appointment.serviceIds || []).reduce((inner, serviceId) => inner + Number(serviceById.get(serviceId)?.durationMinutes || 30), 0);
    }, 0);
    const plannedMinutes = schedules.reduce((sum, schedule) => sum + this.scheduleMinutes(schedule), 0) || staff.length * 14 * 60;
    const revenue = activeAppointments.reduce((sum, appointment) => {
      const explicit = Number(appointment.estimatedAmount || appointment.amount || appointment.total || appointment.value || 0);
      if (explicit) return sum + explicit;
      return sum + (appointment.serviceIds || []).reduce((inner, serviceId) => inner + Number(serviceById.get(serviceId)?.price || 0), 0);
    }, 0);
    const byStatus = summaryAppointments.reduce((map, appointment) => {
      const rawStatus = String(appointment.status || "booked").toLowerCase();
      const status = rawStatus === "completed" && appointment.billingLocked ? "billed" : rawStatus;
      map[status] = (map[status] || 0) + 1;
      return map;
    }, {});
    const countStatuses = (...statuses) => statuses.reduce((sum, status) => sum + (byStatus[status] || 0), 0);
    return {
      booked: activeAppointments.length,
      scheduled: countStatuses("booked", "confirmed", "payment_pending"),
      arrived: countStatuses("arrived", "waiting"),
      inService: countStatuses("in-service", "started"),
      completed: countStatuses("completed", "billed", "paid"),
      noShow: byStatus["no-show"] || 0,
      cancelled: byStatus.cancelled || byStatus.canceled || 0,
      revenue,
      capacityPct: plannedMinutes ? Math.round((bookedMinutes / plannedMinutes) * 100) : 0,
      bookedMinutes,
      plannedMinutes,
      conflicts: this.conflictCount(visibleAppointments),
      waitlist: waitlist.length,
      blockedTimes: blockedTimes.length,
      plannedShifts: schedules.length
    };
  }

  actionQueue({ appointments = [], visibleAppointments = [], schedules = [], blockedTimes = [], waitlist = [], staff = [], services = [], summary = {} } = {}) {
    const serviceById = new Map(services.map((service) => [service.id, service]));
    const staffById = new Map(staff.map((person) => [person.id, person]));
    const rows = [];
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    const push = (row) => rows.push({
      id: id("booking_action"),
      status: "open",
      ...row
    });

    for (const pair of this.conflictPairs(visibleAppointments).slice(0, 20)) {
      push({
        type: pair.sharedStaff ? "conflict_detection" : "chair_conflict",
        priority: "critical",
        appointmentId: pair.left.id,
        relatedAppointmentId: pair.right.id,
        clientId: pair.left.clientId || pair.right.clientId || "",
        staffId: pair.left.staffId || pair.right.staffId || "",
        title: pair.sharedStaff ? "Staff overlap detected" : "Chair overlap detected",
        detail: `${pair.left.startAt || ""} clashes with ${pair.right.startAt || ""}`,
        suggestedAction: "Move one appointment or assign a different staff/chair before confirmation.",
        dueAt: pair.left.startAt || pair.right.startAt || ""
      });
    }

    for (const appointment of visibleAppointments.filter((row) => String(row.status || "").toLowerCase() === "payment_pending").slice(0, 20)) {
      push({
        type: "deposit_follow_up",
        priority: "high",
        appointmentId: appointment.id,
        clientId: appointment.clientId || "",
        staffId: appointment.staffId || "",
        title: "Deposit pending booking",
        detail: this.appointmentServicesLabel(appointment, serviceById),
        suggestedAction: "Confirm payment link status or collect advance before marking booked.",
        dueAt: appointment.startAt || ""
      });
    }

    for (const appointment of visibleAppointments.filter((row) => String(row.status || "").toLowerCase() === "no-show").slice(0, 20)) {
      push({
        type: "no_show_recovery",
        priority: "medium",
        appointmentId: appointment.id,
        clientId: appointment.clientId || "",
        staffId: appointment.staffId || "",
        title: "No-show recovery",
        detail: this.appointmentServicesLabel(appointment, serviceById),
        suggestedAction: "Send recovery message, collect policy note, or move client to rebooking follow-up.",
        dueAt: appointment.startAt || ""
      });
    }

    for (const row of waitlist.slice(0, 25)) {
      push({
        type: "waitlist_match",
        priority: Number(row.priority || 0) >= 8 ? "high" : "medium",
        clientId: row.clientId || "",
        staffId: row.staffId || "",
        title: "Waitlist client ready",
        detail: this.waitlistServiceLabel(row, serviceById),
        suggestedAction: "Match with the next safe slot or promote from waitlist.",
        dueAt: row.preferredDate || row.windowStart || ""
      });
    }

    const missingAssignment = visibleAppointments
      .filter((row) => !row.staffId || !this.appointmentServiceIds(row).length)
      .slice(0, 20);
    for (const appointment of missingAssignment) {
      push({
        type: "staff_service_matching",
        priority: "high",
        appointmentId: appointment.id,
        clientId: appointment.clientId || "",
        staffId: appointment.staffId || "",
        title: "Staff/service assignment incomplete",
        detail: this.appointmentServicesLabel(appointment, serviceById),
        suggestedAction: "Assign the correct staff and service before sending confirmation.",
        dueAt: appointment.startAt || ""
      });
    }

    if (Number(summary.capacityPct || 0) >= 90) {
      push({
        type: "capacity_optimization",
        priority: Number(summary.capacityPct || 0) >= 110 ? "critical" : "high",
        title: "Capacity pressure high",
        detail: `${summary.capacityPct}% booked, ${summary.bookedMinutes || 0}/${summary.plannedMinutes || 0} minutes used`,
        suggestedAction: "Add backup staff, open another chair, or move flexible appointments.",
        dueAt: ""
      });
    } else if (Number(summary.capacityPct || 0) < 45 && waitlist.length) {
      push({
        type: "capacity_optimization",
        priority: "medium",
        title: "Capacity available with waitlist",
        detail: `${summary.capacityPct || 0}% booked and ${waitlist.length} waitlist client(s)`,
        suggestedAction: "Promote waitlist clients into safe open slots.",
        dueAt: ""
      });
    }

    for (const block of blockedTimes.slice(0, 10)) {
      push({
        type: "calendar_sync",
        priority: "low",
        staffId: block.staffId || "",
        title: "Blocked time on calendar",
        detail: `${staffById.get(block.staffId)?.name || block.staffId || "Staff"} ${block.startAt || ""}`,
        suggestedAction: "Keep calendar feed synced so online booking avoids unavailable time.",
        dueAt: block.startAt || ""
      });
    }

    return rows
      .sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || String(a.dueAt || "").localeCompare(String(b.dueAt || "")))
      .slice(0, 120);
  }

  scheduleMinutes(schedule) {
    const start = normalizeTime(schedule.startTime);
    const end = normalizeTime(schedule.endTime);
    if (!start || !end) return 0;
    const date = schedule.scheduleDate || today();
    const minutes = minutesBetween(isoAt(date, start), isoAt(date, end));
    return minutes > 0 ? minutes : minutes + 24 * 60;
  }

  conflictCount(rows) {
    let count = 0;
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (INACTIVE_APPOINTMENT_STATUSES.has(String(a.status || "").toLowerCase())) continue;
        if (INACTIVE_APPOINTMENT_STATUSES.has(String(b.status || "").toLowerCase())) continue;
        const sharedStaff = a.staffId && a.staffId === b.staffId;
        const sharedChair = a.chair && a.chair === b.chair;
        if ((sharedStaff || sharedChair) && overlaps(a.startAt, a.endAt || addMinutes(a.startAt, 30), b.startAt, b.endAt || addMinutes(b.startAt, 30))) {
          count += 1;
        }
      }
    }
    return count;
  }

  conflictPairs(rows) {
    const pairs = [];
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const left = rows[i];
        const right = rows[j];
        if (INACTIVE_APPOINTMENT_STATUSES.has(String(left.status || "").toLowerCase())) continue;
        if (INACTIVE_APPOINTMENT_STATUSES.has(String(right.status || "").toLowerCase())) continue;
        const sharedStaff = left.staffId && left.staffId === right.staffId;
        const sharedChair = left.chair && left.chair === right.chair;
        if ((sharedStaff || sharedChair) && overlaps(left.startAt, left.endAt || addMinutes(left.startAt, 30), right.startAt, right.endAt || addMinutes(right.startAt, 30))) {
          pairs.push({ left, right, sharedStaff, sharedChair });
        }
      }
    }
    return pairs;
  }

  appointmentServiceIds(appointment = {}) {
    return Array.isArray(appointment.serviceIds) ? appointment.serviceIds : [];
  }

  appointmentServicesLabel(appointment = {}, serviceById = new Map()) {
    const names = this.appointmentServiceIds(appointment).map((serviceId) => serviceById.get(serviceId)?.name || serviceId).filter(Boolean);
    return names.join(", ") || "Service details pending";
  }

  waitlistServiceLabel(row = {}, serviceById = new Map()) {
    const ids = Array.isArray(row.serviceIds) ? row.serviceIds : [row.serviceId].filter(Boolean);
    const names = ids.map((serviceId) => serviceById.get(serviceId)?.name || serviceId).filter(Boolean);
    return names.join(", ") || "Any matching service";
  }
}

export const enterpriseSchedulerService = new EnterpriseSchedulerService();
