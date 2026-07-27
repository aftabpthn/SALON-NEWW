import { repositories } from "../repositories/repository-registry.js";
import { badRequest, conflict, notFound } from "../utils/app-error.js";
import { appointmentActivityService, APPOINTMENT_ACTIVITY_ACTIONS } from "./appointment-activity.service.js";
import { customerSalonRelationshipService } from "./customer-salon-relationship.service.js";
import { resourceService } from "./resource.service.js";
import { salonOperationsService } from "./salon-operations.service.js";
import { tenantService } from "./tenant.service.js";
import { waitlistService } from "./waitlist.service.js";
import { warrantyService } from "./warranty.service.js";
import { db } from "../db.js";

function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {}, "appointments");
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function addMinutes(value, minutes) {
  return new Date(new Date(value).getTime() + Number(minutes || 0) * 60000).toISOString();
}

function appointment(id, access) {
  const row = repositories.appointments.getById(id, scope(access));
  if (!row) throw notFound("Appointment not found");
  if (row.branchId) tenantService.assertBranchAccess(access, row.branchId);
  return row;
}

function updateStatus(id, status, access, extra = {}, meta = {}) {
  const current = appointment(id, access);
  const updated = repositories.appointments.update(id, { status, ...extra }, scope(access, current.branchId));
  appointmentActivityService.logActivity({
    action: meta.action || actionForStatus(status),
    appointment: updated,
    oldData: current,
    newData: updated,
    reason: meta.reason || "",
    source: meta.source || "appointment-lifecycle",
    access
  });
  return { appointment: updated };
}

function bookingGroupIdOf(row = {}) {
  return String(row.bookingGroupId || row.booking_group_id || "").trim();
}

function appointmentDateKey(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

function closeCreatedAt(left, right) {
  const leftTime = new Date(left || "").getTime();
  const rightTime = new Date(right || "").getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && Math.abs(leftTime - rightTime) <= 5 * 60 * 1000;
}

function requestedGroupMembers(current, payload = {}, access) {
  const ids = Array.isArray(payload.appointmentIds) ? payload.appointmentIds : [];
  const uniqueIds = [...new Set([current.id, ...ids].map((id) => String(id || "").trim()).filter(Boolean))];
  if (uniqueIds.length <= 1) return [];
  return uniqueIds
    .map((id) => appointment(id, access))
    .filter((row) => row.branchId === current.branchId && row.clientId === current.clientId);
}

function groupMembersFor(current, access, payload = {}) {
  const requested = requestedGroupMembers(current, payload, access);
  if (requested.length > 1) return requested;
  const bookingGroupId = bookingGroupIdOf(current);
  const rows = repositories.appointments.list({ branchId: current.branchId || "", limit: 10000 }, scope(access, current.branchId || ""));
  if (!bookingGroupId) {
    const clientId = String(current.clientId || "").trim();
    const dateKey = appointmentDateKey(current.startAt || current.date);
    const sameClientDayRows = rows.filter((row) => {
      const status = String(row.status || "").toLowerCase();
      return clientId
        && String(row.clientId || "").trim() === clientId
        && appointmentDateKey(row.startAt || row.date) === dateKey
        && !["deleted", "no-show"].includes(status);
    });
    const chair = String(current.chair || "").trim();
    const room = String(current.room || "").trim();
    const sameResourceRows = sameClientDayRows.filter((row) => {
      const sameChair = chair && String(row.chair || "").trim() === chair;
      const sameRoom = room && String(row.room || "").trim() === room;
      return sameChair || sameRoom;
    });
    if (sameResourceRows.length > 1) return sameResourceRows;
    const sameCreatedRows = sameClientDayRows.filter((row) => closeCreatedAt(row.createdAt || row.created_at, current.createdAt || current.created_at));
    return sameCreatedRows.length > 1 ? sameCreatedRows : [current];
  }
  return rows.filter((row) => bookingGroupIdOf(row) === bookingGroupId);
}

function statusExtraFor(current, status, payload = {}) {
  if (!payload.reason) return {};
  return {
    notes: [current.notes, `Status ${status}: ${payload.reason}`].filter(Boolean).join(" | ")
  };
}

function updateStatusForGroup(id, status, payload = {}, access) {
  const current = appointment(id, access);
  const members = groupMembersFor(current, access);
  const appointments = members.map((member) => updateStatus(member.id, status, access, statusExtraFor(member, status, payload), {
    action: actionForStatus(status),
    reason: payload.reason || "",
    source: "status-board-group"
  }).appointment);
  return {
    appointment: appointments.find((row) => row.id === id) || appointments[0],
    appointments,
    bookingGroupId: bookingGroupIdOf(current),
    appliedToGroup: appointments.length > 1
  };
}

const ALLOWED_STATUSES = new Set([
  "draft",
  "booked",
  "confirmed",
  "arrived",
  "waiting",
  "in-service",
  "completed",
  "billed",
  "paid",
  "cancelled",
  "no-show",
  "rescheduled"
]);

export const appointmentLifecycleService = {
  setStatus(id, payload = {}, access) {
    const status = String(payload.status || "").trim().toLowerCase();
    if (!ALLOWED_STATUSES.has(status)) throw badRequest("Unsupported appointment status");
    if (payload.applyGroup || payload.applyBookingGroup || payload.scope === "bookingGroup") {
      return updateStatusForGroup(id, status, payload, access);
    }
    const current = appointment(id, access);
    return updateStatus(id, status, access, statusExtraFor(current, status, payload), {
      action: actionForStatus(status),
      reason: payload.reason || "",
      source: "status-board"
    });
  },

  checkIn(id, access) {
    return updateStatus(id, "arrived", access, {}, { action: APPOINTMENT_ACTIVITY_ACTIONS.ARRIVED, source: "check-in" });
  },

  startService(id, access) {
    return updateStatus(id, "in-service", access, {}, { action: APPOINTMENT_ACTIVITY_ACTIONS.STARTED, source: "service-start" });
  },

  complete(id, payload = {}, access) {
    const current = appointment(id, access);
    const result = salonOperationsService.completeAppointment(id, payload.notes, access);
    const warranty = warrantyService.applyWarrantyOnCompletion(id, access);
    appointmentActivityService.logActivity({
      action: APPOINTMENT_ACTIVITY_ACTIONS.COMPLETED,
      appointment: result.appointment,
      oldData: current,
      newData: result.appointment,
      reason: payload.notes || payload.reason || "",
      source: "service-complete",
      access
    });

    // Track customer-salon relationship on completion
    try {
      const appt = result.appointment;
      if (appt && appt.clientId && appt.tenantId) {
        let branchName = "";
        try {
          const branch = db.prepare("SELECT name FROM branches WHERE id = @branchId AND tenantId = @tenantId").get({ branchId: appt.branchId, tenantId: appt.tenantId });
          branchName = branch?.name || "";
        } catch (_) { /* branch lookup non-critical */ }
        customerSalonRelationshipService.recordVisit({
          customerId: appt.clientId,
          tenantId: appt.tenantId,
          branchId: appt.branchId || "",
          businessId: appt.branchId || "",
          businessName: branchName
        });
      }
    } catch (_) {
      // Non-critical: don't fail booking completion if relationship tracking fails
    }

    return { ...result, warranty };
  },

  noShow(id, payload = {}, access) {
    return updateStatus(id, "no-show", access, {
      notes: [appointment(id, access).notes, payload.reason ? `No-show reason: ${payload.reason}` : ""].filter(Boolean).join(" | ")
    }, {
      action: APPOINTMENT_ACTIVITY_ACTIONS.NO_SHOW,
      reason: payload.reason || "",
      source: "no-show"
    });
  },

  cancel(id, payload = {}, access) {
    const current = appointment(id, access);
    const members = groupMembersFor(current, access, payload);
    const locked = members.find((member) => ["completed", "paid"].includes(String(member.status || "").toLowerCase()));
    if (locked) {
      throw conflict("Completed or paid appointments cannot be cancelled");
    }
    const appointments = members.map((member) => updateStatus(member.id, "cancelled", access, {
      notes: [member.notes, payload.reason ? `Cancellation reason: ${payload.reason}` : ""].filter(Boolean).join(" | ")
    }, {
      action: APPOINTMENT_ACTIVITY_ACTIONS.CANCELLED,
      reason: payload.reason || "",
      source: "cancellation"
    }).appointment);
    const result = {
      appointment: appointments.find((row) => row.id === id) || appointments[0],
      appointments,
      bookingGroupId: bookingGroupIdOf(current),
      appliedToGroup: appointments.length > 1
    };
    const serviceIds = Array.isArray(current.serviceIds) ? current.serviceIds : [];
    result.waitlistOffer = waitlistService.autoFillForFreedSlot({
      branchId: current.branchId || "",
      serviceId: current.serviceId || serviceIds[0] || "",
      staffId: current.staffId || "",
      startAt: current.startAt || "",
      endAt: current.endAt || (current.startAt ? addMinutes(current.startAt, 45) : "")
    }, access);
    return result;
  },

  reschedule(id, payload = {}, access, req = null) {
    const current = appointment(id, access);
    if (["completed", "paid", "cancelled"].includes(current.status)) {
      throw conflict("This appointment cannot be rescheduled");
    }
    const slot = payload.slot || {};
    const nextStart = payload.startAt || slot.startAt || slot.startTime;
    if (!nextStart) throw badRequest("New start time is required");
    const durationMs = new Date(current.endAt || addMinutes(current.startAt, 45)).getTime() - new Date(current.startAt).getTime();
    const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 45 * 60000;
    const nextPayload = {
      branchId: payload.branchId || slot.branchId || current.branchId,
      staffId: payload.staffId || slot.staffId || current.staffId,
      chair: payload.chair || slot.chair || slot.chairId || current.chair || "",
      room: payload.room || slot.room || slot.roomId || current.room || "",
      startAt: new Date(nextStart).toISOString(),
      endAt: payload.endAt || slot.endAt || slot.endTime || new Date(new Date(nextStart).getTime() + safeDurationMs).toISOString(),
      status: "rescheduled",
      notes: [current.notes, payload.reason ? `Rescheduled: ${payload.reason}` : "Rescheduled"].filter(Boolean).join(" | ")
    };
    const updated = resourceService.update("appointments", id, nextPayload, access, {
      req,
      activityAction: APPOINTMENT_ACTIVITY_ACTIONS.RESCHEDULED
    });
    return { appointment: updated };
  },

  duplicate(id, payload = {}, access, req = null) {
    const current = appointment(id, access);
    const startAt = payload.startAt || addMinutes(current.startAt, 7 * 24 * 60);
    const duration = new Date(current.endAt || addMinutes(current.startAt, 45)).getTime() - new Date(current.startAt).getTime();
    if (Number.isNaN(duration) || duration <= 0) throw badRequest("Source appointment has invalid timing");
    const duplicatePayload = {
      clientId: payload.clientId || current.clientId,
      staffId: payload.staffId || current.staffId,
      branchId: payload.branchId || current.branchId,
      serviceIds: payload.serviceIds || current.serviceIds || [],
      startAt,
      endAt: payload.endAt || new Date(new Date(startAt).getTime() + duration).toISOString(),
      status: payload.status || "booked",
      source: "duplicate",
      sourceChannel: "front_desk",
      chair: payload.chair || current.chair || "",
      room: payload.room || current.room || "",
      notes: [payload.notes || "", `Duplicated from ${current.id}`].filter(Boolean).join(" | ")
    };
    const created = resourceService.create("appointments", duplicatePayload, access, {
      req,
      activityAction: APPOINTMENT_ACTIVITY_ACTIONS.DUPLICATED
    });
    return { sourceAppointmentId: current.id, appointment: created };
  },

  convertToSale(id, payload = {}, access) {
    const current = appointment(id, access);
    if (current.status !== "completed") throw conflict("Appointment must be completed before billing");
    const serviceIds = current.serviceIds || [];
    const items = serviceIds.map((serviceId) => ({ type: "service", id: serviceId, quantity: 1 }));
    if (!items.length) throw badRequest("Appointment has no billable services");
    const result = salonOperationsService.checkoutSale({
      clientId: current.clientId,
      appointmentId: current.id,
      branchId: current.branchId,
      staffId: current.staffId,
      items,
      payments: payload.payments || []
    }, access);
    const updated = repositories.appointments.update(current.id, { status: current.status, billable: 1 }, scope(access, current.branchId));
    appointmentActivityService.logActivity({
      action: APPOINTMENT_ACTIVITY_ACTIONS.BILLED,
      appointment: updated,
      oldData: current,
      newData: updated,
      reason: "Converted appointment to POS sale",
      source: "convert-to-sale",
      access
    });
    return { ...result, appointment: updated };
  }
};

function actionForStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "cancelled") return APPOINTMENT_ACTIVITY_ACTIONS.CANCELLED;
  if (normalized === "no-show") return APPOINTMENT_ACTIVITY_ACTIONS.NO_SHOW;
  if (normalized === "completed") return APPOINTMENT_ACTIVITY_ACTIONS.COMPLETED;
  if (normalized === "arrived") return APPOINTMENT_ACTIVITY_ACTIONS.ARRIVED;
  if (normalized === "in-service") return APPOINTMENT_ACTIVITY_ACTIONS.STARTED;
  if (["billed", "paid"].includes(normalized)) return APPOINTMENT_ACTIVITY_ACTIONS.BILLED;
  if (normalized === "rescheduled") return APPOINTMENT_ACTIVITY_ACTIONS.RESCHEDULED;
  return APPOINTMENT_ACTIVITY_ACTIONS.STATUS_CHANGED;
}
