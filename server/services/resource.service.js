import { columnsFor, db, deserialize, resources, serialize } from "../db.js";
import { AppError, conflict, notFound } from "../utils/app-error.js";
import { repositoryForResource, repositories } from "../repositories/repository-registry.js";
import { availabilityAugmentService } from "./availability-augment.service.js";
import { appointmentActivityService, APPOINTMENT_ACTIVITY_ACTIONS } from "./appointment-activity.service.js";
import { bookingAttributionService } from "./booking-attribution.service.js";
import { jobQueueService } from "./job-queue.service.js";
import { serviceRulesService } from "./service-rules.service.js";
import { slotReservationService } from "./slot-reservation.service.js";
import { smartBookingService } from "./smart-booking.service.js";
import { tenantService } from "./tenant.service.js";

function serviceDuration(serviceIds = []) {
  return serviceIds.reduce((minutes, serviceId) => {
    const service = repositories.services.getById(serviceId);
    return minutes + Number(service?.durationMinutes || 0);
  }, 0);
}

function compactClientRow(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    gender: row.gender,
    birthday: row.birthday,
    anniversary: row.anniversary,
    tags: row.tags,
    notes: row.notes,
    walletBalance: row.walletBalance,
    loyaltyPoints: row.loyaltyPoints,
    membershipId: row.membershipId,
    branchId: row.branchId,
    totalSpend: row.totalSpend,
    visitCount: row.visitCount,
    lastVisitAt: row.lastVisitAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tenantId: row.tenantId,
    imported: row.imported,
    originalSystem: row.originalSystem,
    originalRecordId: row.originalRecordId,
    importBatchId: row.importBatchId
  };
}

function clientListNumber(value, fallback, max) {
  const next = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(next) || next <= 0) return fallback;
  return Math.min(next, max);
}

export class ResourceService {
  list(resource, query, access) {
    if (query?.branchId) tenantService.assertBranchAccess(access, query.branchId);
    const listQuery = resource === "clients" && !query?.limit ? { ...query, limit: 10000 } : query;
    if (resource === "clients" && truthy(listQuery?.compact)) {
      return this.listCompactClients(listQuery, access);
    }
    const rows = this.repository(resource).list(listQuery, this.listScope(resource, listQuery, access));
    if (resource === "clients" && !truthy(query?.includeDeleted)) {
      const activeRows = rows.filter((row) => !row.deletedAt);
      return truthy(query?.compact) ? activeRows.map(compactClientRow) : activeRows;
    }
    return rows;
  }

  listCompactClients(query = {}, access = {}) {
    const scope = this.listScope("clients", query, access);
    const where = ["tenantId = @tenantId"];
    const params = {
      tenantId: scope.tenantId || access.tenantId,
      limit: clientListNumber(query.limit, 150, 1000),
      offset: Math.max(0, Number.parseInt(String(query.offset || 0), 10) || 0)
    };
    const branchId = query.branchId || scope.branchId || "";
    if (branchId) {
      where.push("branchId = @branchId");
      params.branchId = branchId;
    }
    if (!truthy(query.includeDeleted)) {
      where.push("(deletedAt IS NULL OR deletedAt = '')");
    }
    const search = String(query.q || query.search || "").trim();
    if (search) {
      where.push("(name LIKE @q OR phone LIKE @q OR email LIKE @q OR tags LIKE @q OR notes LIKE @q OR originalRecordId LIKE @q)");
      params.q = `%${search}%`;
    }
    return db.prepare(`
      SELECT * FROM clients
      WHERE ${where.join(" AND ")}
      ORDER BY createdAt DESC
      LIMIT @limit OFFSET @offset
    `).all(params).map((row) => compactClientRow(deserialize("clients", row)));
  }

  get(resource, id, access) {
    const row = this.repository(resource).getById(id, tenantService.accessScope(access, resource));
    if (!row) throw notFound(`${resource} record not found`);
    if (row.branchId) tenantService.assertBranchAccess(access, row.branchId);
    return row;
  }

  create(resource, payload, access, options = {}) {
    tenantService.ensureSubscriptionActive(access.tenantId);
    tenantService.enforceUsageLimit(access.tenantId, resource);
    const nextPayload = this.preparePayload(resource, payload, access, { ...options, action: "create" });
    if (nextPayload.branchId) tenantService.assertBranchAccess(access, nextPayload.branchId);
    const created = this.repository(resource).create(nextPayload, tenantService.accessScope(access, resource));
    if (resource === "appointments" && created.reservedFromSlotId) {
      slotReservationService.convertToBooking(created.reservedFromSlotId, created.id, access);
    }
    if (resource === "appointments") {
      jobQueueService.enqueue(access.tenantId, "whatsapp_send", {
        event: "appointment_confirmation",
        appointmentId: created.id,
        clientId: created.clientId,
        branchId: created.branchId,
        startAt: created.startAt,
        status: created.status
      });
      appointmentActivityService.logActivity({
        action: options.activityAction || APPOINTMENT_ACTIVITY_ACTIONS.BOOKED,
        appointment: created,
        oldData: {},
        newData: created,
        reason: payload.reason || "",
        source: created.sourceChannel || created.source || "resource-create",
        access,
        req: options.req
      });
    }
    tenantService.recordUsage({
      tenantId: access.tenantId,
      metric: resource,
      referenceType: resource,
      referenceId: created.id
    });
    return created;
  }

  update(resource, id, payload, access, options = {}) {
    const existing = this.get(resource, id, access);
    const nextPayload = this.preparePayload(resource, payload, access, { ...options, action: "update", existing });
    if (nextPayload.branchId) tenantService.assertBranchAccess(access, nextPayload.branchId);
    const updated = resource === "appointments" && options.ifMatch
      ? this.updateAppointmentWithVersion(id, nextPayload, access, options.ifMatch)
      : this.repository(resource).update(id, nextPayload, tenantService.accessScope(access, resource));
    if (resource === "appointments" && !options.skipActivityLog) {
      appointmentActivityService.logActivity({
        action: options.activityAction || appointmentActivityService.classifyUpdate(existing, updated),
        appointment: updated,
        oldData: existing,
        newData: updated,
        reason: payload.reason || payload.notes || "",
        source: updated.sourceChannel || updated.source || "resource-update",
        access,
        req: options.req
      });
    }
    return updated;
  }

  delete(resource, id, access) {
    if (resource === "clients") return this.deleteClient(id, access);
    const existing = this.get(resource, id, access);
    const deleted = this.repository(resource).delete(id, tenantService.accessScope(access, resource));
    if (resource === "appointments" && deleted) {
      appointmentActivityService.logActivity({
        action: APPOINTMENT_ACTIVITY_ACTIONS.DELETED,
        appointment: existing,
        oldData: existing,
        newData: { ...existing, status: "deleted" },
        reason: "Appointment deleted through resource API",
        source: "resource-delete",
        access
      });
    }
    return deleted;
  }

  deleteClient(id, access) {
    const existing = this.repository("clients").getById(id, tenantService.accessScope(access, "clients"));
    if (!existing) {
      return { id, deleted: true, alreadyDeleted: true };
    }
    if (existing.branchId) tenantService.assertBranchAccess(access, existing.branchId);
    if (existing.deletedAt) {
      return { id, archived: true, alreadyDeleted: true };
    }
    try {
      return this.repository("clients").delete(id, tenantService.accessScope(access, "clients"));
    } catch (error) {
      if (!isForeignKeyConstraint(error)) throw error;
      const columns = columnsFor("clients");
      const now = new Date().toISOString();
      const payload = {
        deletedAt: now,
        deletedBy: access.userId || access.user?.id || "system",
        deletedReason: "Archived instead of hard delete because this client has linked invoices, payments, appointments or wallet history."
      };
      const safePayload = Object.fromEntries(Object.entries(payload).filter(([key]) => columns.includes(key)));
      const archived = this.repository("clients").update(id, safePayload, tenantService.accessScope(access, "clients"));
      return { id: archived.id, archived: true };
    }
  }

  repository(resource) {
    if (!resources[resource]) throw notFound(`Unknown API resource: ${resource}`);
    return repositoryForResource(resource);
  }

  listScope(resource, query = {}, access = {}) {
    const scope = tenantService.accessScope(access, resource);
    if (!truthy(query.includeAllBranches)) return scope;
    const allBranchResources = new Set(["packages", "memberships", "giftCards"]);
    const privilegedRoles = new Set(["superAdmin", "owner", "admin", "manager"]);
    if (!allBranchResources.has(resource) || !privilegedRoles.has(access.role)) return scope;
    return { tenantId: access.tenantId };
  }

  preparePayload(resource, payload, access, options = {}) {
    if (resource === "staff") return normalizeStaffPayload(payload);
    if (!["appointments", "bookings"].includes(resource)) return { ...payload };
    const existing = options.existing || {};
    const nextPayload = normalizeAppointmentPayload({ ...payload }, options.req);
    const schedulingTouched = options.action === "create" || ["branchId", "staffId", "chair", "chairId", "room", "roomId", "startAt", "endAt", "serviceId", "serviceIds"].some((key) => key in nextPayload);
    if (nextPayload.branchId) tenantService.assertBranchAccess(access, nextPayload.branchId);

    const candidate = { ...existing, ...nextPayload };
    if (candidate.startAt) candidate.startAt = new Date(candidate.startAt).toISOString();
    if (candidate.endAt) candidate.endAt = new Date(candidate.endAt).toISOString();
    if (candidate.startAt && !candidate.endAt) {
      const minutes = serviceDuration(candidate.serviceIds || []);
      candidate.endAt = new Date(new Date(candidate.startAt).getTime() + Math.max(minutes, 30) * 60000).toISOString();
      nextPayload.endAt = candidate.endAt;
    }

    if (schedulingTouched && Array.isArray(candidate.serviceIds) && candidate.serviceIds.length) {
      const chain = serviceRulesService.resolveServiceChain(access.tenantId, candidate.serviceIds);
      candidate.serviceIds = chain.map((item) => item.serviceId);
      nextPayload.serviceIds = candidate.serviceIds;
      const combo = serviceRulesService.validateServiceCombo(access.tenantId, candidate.clientId, candidate.serviceIds, candidate.startAt);
      const blocking = combo.violations.filter((violation) => !serviceRulesService.canOverride(violation, access.role));
      if (blocking.length) {
        throw new AppError("Service combination restricted", 422, { violations: blocking });
      }
    }

    if (schedulingTouched && candidate.branchId && candidate.startAt) {
      const source = candidate.sourceChannel || candidate.source || "front-desk";
      const blackout = availabilityAugmentService.isDateBlocked({
        tenantId: access.tenantId,
        branchId: candidate.branchId,
        date: candidate.startAt,
        source: source === "walkin" ? "walkin" : "online"
      });
      if (blackout) throw conflict("Selected date is blocked for booking", { blackout });
    }

    if (schedulingTouched && !options.skipSchedulingConflictCheck && candidate.branchId && candidate.startAt && candidate.endAt && (candidate.staffId || candidate.chair)) {
      const conflicts = smartBookingService
        .findConflicts({
          branchId: candidate.branchId,
          staffId: candidate.staffId || "",
          chair: candidate.chair || candidate.chairId || "",
          startAt: candidate.startAt,
          endAt: candidate.endAt,
          access
        })
        .filter((item) => item.id !== existing.id);
      if (conflicts.length) throw conflict("Appointment conflict detected", { conflicts });

      const holds = availabilityAugmentService.activeHolds({
        tenantId: access.tenantId,
        branchId: candidate.branchId,
        staffId: candidate.staffId || "",
        chairId: candidate.chair || candidate.chairId || "",
        roomId: candidate.room || candidate.roomId || "",
        startTime: candidate.startAt,
        endTime: candidate.endAt,
        excludeHoldId: candidate.reservedFromSlotId || ""
      });
      if (holds.length) throw conflict("Selected slot is temporarily held", { holds });
    }

    if (candidate.endAt && !nextPayload.endAt) nextPayload.endAt = candidate.endAt;
    delete nextPayload.version;
    return nextPayload;
  }

  updateAppointmentWithVersion(id, payload, access, ifMatch) {
    const expectedVersion = Number(String(ifMatch).replace(/^W\//, "").replaceAll("\"", ""));
    if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
      throw new AppError("Valid If-Match version is required", 412);
    }
    const table = resources.appointments.table;
    const columns = columnsFor(table);
    const stamped = Object.fromEntries(
      Object.entries(serialize(table, { ...payload, version: expectedVersion + 1 })).filter(([key]) => columns.includes(key))
    );
    const keys = Object.keys(stamped).filter((key) => key !== "id" && key !== "createdAt" && key !== "tenantId");
    if (!keys.length) return this.get("appointments", id, access);
    const setSql = keys.map((key) => `${key} = @${key}`).join(", ");
    const result = db.prepare(
      `UPDATE appointments
       SET ${setSql}
       WHERE id = @id AND tenantId = @tenantId AND COALESCE(version, 1) = @expectedVersion`
    ).run({ ...stamped, id, tenantId: access.tenantId, expectedVersion });
    if (!result.changes) {
      const current = this.get("appointments", id, access);
      throw conflict("Appointment was changed by someone else. Please refresh and try again.", {
        currentVersion: current.version || 1
      });
    }
    return this.get("appointments", id, access);
  }
}

export const resourceService = new ResourceService();

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function isForeignKeyConstraint(error) {
  return String(error?.code || "").includes("SQLITE_CONSTRAINT_FOREIGNKEY")
    || String(error?.message || "").includes("FOREIGN KEY constraint failed");
}

function normalizeAppointmentPayload(payload, req) {
  const sourceMap = {
    source_channel: "sourceChannel",
    source_campaign: "sourceCampaign",
    source_medium: "sourceMedium",
    utm_source: "utmSource",
    utm_medium: "utmMedium",
    utm_campaign: "utmCampaign",
    referrer_customer_id: "referrerCustomerId",
    is_touchup: "isTouchup",
    touchup_of_appointment_id: "touchupOfAppointmentId",
    warranty_until: "warrantyUntil",
    booking_group_id: "bookingGroupId",
    group_member_role: "groupMemberRole",
    idempotency_key: "idempotencyKey",
    reserved_from_slot_id: "reservedFromSlotId"
  };
  for (const [from, to] of Object.entries(sourceMap)) {
    if (payload[from] !== undefined && payload[to] === undefined) payload[to] = payload[from];
    delete payload[from];
  }
  if (payload.serviceId && !payload.serviceIds) payload.serviceIds = [payload.serviceId];
  if (req) {
    const attribution = bookingAttributionService.inferSourceFromRequest(req);
    if (!payload.sourceChannel) payload.sourceChannel = attribution.sourceChannel;
    if (!payload.sourceMedium) payload.sourceMedium = attribution.sourceMedium;
    if (!payload.idempotencyKey && req.get("Idempotency-Key")) payload.idempotencyKey = req.get("Idempotency-Key");
  }
  if (!payload.source && payload.sourceChannel) payload.source = payload.sourceChannel;
  if (!payload.sourceChannel && payload.source) payload.sourceChannel = payload.source;
  return payload;
}

function normalizeStaffPayload(payload = {}) {
  const jsonFields = new Set([
    "permissions",
    "multiBranchIds",
    "breakRules",
    "weeklyOffs",
    "targetMetrics",
    "leaveBalance",
    "biometricConfig",
    "aiProfile",
    "employeeRoles",
    "serviceOverrides",
    "commissionSlabs"
  ]);
  const normalized = { ...payload };
  for (const field of jsonFields) {
    const value = normalized[field];
    if (value !== undefined && value !== null && typeof value === "object") {
      normalized[field] = JSON.stringify(value);
    }
  }
  return normalized;
}
