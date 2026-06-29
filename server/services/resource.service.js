import { columnsFor, db, deserialize, resources, serialize } from "../db.js";
import { AppError, badRequest, conflict, notFound } from "../utils/app-error.js";
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

export class ResourceService {
  list(resource, query, access) {
    if (query?.branchId) tenantService.assertBranchAccess(access, query.branchId);
    const rows = this.repository(resource).list(query, this.listScope(resource, query, access));
    if (resource === "clients" && !truthy(query?.includeDeleted)) {
      return rows.filter((row) => !row.deletedAt);
    }
    return rows;
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
      return this.archiveClient(existing, "Archived instead of hard delete because this client has linked invoices, payments, appointments or wallet history.", access);
    }
  }

  duplicateClients(query = {}, access = {}) {
    const scope = this.listScope("clients", { includeAllBranches: truthy(query.includeAllBranches) || truthy(query.allBranches) }, access);
    const clients = listClientsForDuplicateScan(scope);
    return buildDuplicateClientGroups(clients);
  }

  mergeAllDuplicateClients(payload = {}, access = {}) {
    const query = {
      includeAllBranches: truthy(payload.includeAllBranches) || truthy(payload.allBranches)
    };
    const groups = this.duplicateClients(query, access);
    const summary = {
      scannedGroups: groups.length,
      mergedGroups: 0,
      mergedClients: 0,
      archivedClientIds: [],
      remainingGroups: 0,
      skippedGroups: 0,
      errors: []
    };

    for (const group of groups) {
      const groupClients = Array.isArray(group.clients) ? group.clients : [];
      const primaryId = String(group.suggestedPrimaryId || groupClients[0]?.id || "");
      const duplicateClientIds = groupClients.map((client) => String(client.id || "")).filter((id) => id && id !== primaryId);
      if (!primaryId || !duplicateClientIds.length) {
        summary.skippedGroups += 1;
        continue;
      }
      try {
        const result = this.mergeDuplicateClients(primaryId, {
          duplicateClientIds,
          reason: payload.reason || "Merged by frontdesk duplicate merge all"
        }, access);
        const archivedIds = Array.isArray(result.archivedClientIds) ? result.archivedClientIds : [];
        summary.mergedGroups += 1;
        summary.mergedClients += archivedIds.length;
        summary.archivedClientIds.push(...archivedIds);
      } catch (error) {
        summary.skippedGroups += 1;
        summary.errors.push({ groupKey: group.groupKey || "", message: error?.message || "Unable to merge duplicate group" });
      }
    }

    summary.archivedClientIds = [...new Set(summary.archivedClientIds)];
    summary.remainingGroups = this.duplicateClients(query, access).length;
    return summary;
  }
  mergeDuplicateClients(primaryId, payload = {}, access = {}) {
    const targetPrimaryId = String(primaryId || "").trim();
    const duplicateClientIds = [...new Set((payload.duplicateClientIds || payload.duplicateIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean))].filter((id) => id !== targetPrimaryId);
    if (!targetPrimaryId) throw badRequest("Primary client is required");
    if (!duplicateClientIds.length) throw badRequest("At least one duplicate client is required");

    const scope = tenantService.accessScope(access, "clients");
    const clients = [targetPrimaryId, ...duplicateClientIds].map((id) => {
      const client = this.repository("clients").getById(id, scope);
      if (!client || client.deletedAt) throw notFound(`Client ${id} not found`);
      if (client.branchId) tenantService.assertBranchAccess(access, client.branchId);
      return client;
    });
    const primary = clients[0];
    const duplicates = clients.slice(1);

    return db.transaction(() => {
      const referenceUpdates = duplicates.flatMap((duplicate) => reassignClientReferences(duplicate.id, primary.id, access.tenantId));
      const updatedPrimary = this.repository("clients").update(primary.id, mergedClientPayload(primary, duplicates), scope);
      const archivedClientIds = duplicates.map((duplicate) => this.archiveClient(
        duplicate,
        `Merged into client ${primary.id}`,
        access
      ).id || duplicate.id);
      return {
        primary: updatedPrimary,
        mergedClientIds: duplicateClientIds,
        archivedClientIds,
        referenceUpdates
      };
    })();
  }

  archiveClient(client, reason, access) {
    const columns = columnsFor("clients");
    const now = new Date().toISOString();
    const payload = {
      deletedAt: now,
      deletedBy: access.userId || access.user?.id || "system",
      deletedReason: reason,
      notes: uniqueText([client.notes, reason])
    };
    const safePayload = Object.fromEntries(Object.entries(payload).filter(([key]) => columns.includes(key)));
    if (!Object.keys(safePayload).length) {
      return this.repository("clients").delete(client.id, tenantService.accessScope(access, "clients"));
    }
    const archived = this.repository("clients").update(client.id, safePayload, tenantService.accessScope(access, "clients"));
    return { id: archived.id, archived: true };
  }

  repository(resource) {
    if (!resources[resource]) throw notFound(`Unknown API resource: ${resource}`);
    return repositoryForResource(resource);
  }

  listScope(resource, query = {}, access = {}) {
    const scope = tenantService.accessScope(access, resource);
    if (!truthy(query.includeAllBranches)) return scope;
    const allBranchResources = new Set(["packages", "memberships", "giftCards", "clients", "invoices", "walletTransactions"]);
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

function listClientsForDuplicateScan(scope = {}) {
  if (!scope.tenantId) return [];
  const columns = columnsFor("clients");
  if (!columns.length) return [];
  const where = ["tenantId = @tenantId"];
  const params = { tenantId: scope.tenantId };
  if (scope.branchId && columns.includes("branchId")) {
    where.push("branchId = @branchId");
    params.branchId = scope.branchId;
  }
  if (columns.includes("deletedAt")) where.push("COALESCE(deletedAt, '') = ''");
  return db.prepare(`SELECT * FROM clients WHERE ${where.join(" AND ")}`).all(params).map((row) => deserialize("clients", row));
}

function buildDuplicateClientGroups(clients = []) {
  const groups = new Map();
  for (const client of clients) {
    const id = String(client.id || "");
    if (!id) continue;
    for (const key of duplicateKeysForClient(client)) {
      if (!groups.has(key.value)) groups.set(key.value, { key, clients: [] });
      groups.get(key.value).clients.push(client);
    }
  }
  return [...groups.values()]
    .filter((group) => group.clients.length > 1)
    .map((group) => duplicateClientGroup(group.key, group.clients))
    .sort((left, right) => right.clients.length - left.clients.length || left.matchLabel.localeCompare(right.matchLabel));
}

function duplicateClientGroup(key, clients) {
  const primary = [...clients].sort((left, right) => clientMergeRank(right) - clientMergeRank(left))[0] || clients[0];
  return {
    groupKey: key.value,
    matchType: key.type,
    matchLabel: key.type === "phone" ? "Same phone" : "Same email",
    matchValues: [key.label],
    suggestedPrimaryId: String(primary?.id || ""),
    duplicateCount: clients.length,
    clients: clients.map(slimDuplicateClient)
  };
}
function duplicateKeysForClient(client) {
  const keys = [];
  const phone = normalizeDuplicatePhone(client.phone || client.mobile || client.mobileNumber || client.contactNumber);
  const email = normalizeDuplicateEmail(client.email);
  if (phone) keys.push({ type: "phone", value: `phone:${phone}`, label: phone });
  if (email) keys.push({ type: "email", value: `email:${email}`, label: email });
  return keys;
}

function normalizeDuplicatePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 7) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeDuplicateEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.includes("@") ? email : "";
}

function clientMergeRank(client) {
  return Number(client.totalSpend || 0)
    + Number(client.visitCount || 0) * 1000
    + Number(client.walletBalance || 0)
    + Number(client.loyaltyPoints || 0)
    + dateScore(client.lastVisitAt);
}

function dateScore(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000000000) : 0;
}

function slimDuplicateClient(client) {
  return {
    id: String(client.id || ""),
    name: client.name || client.fullName || client.clientName || client.customerName || client.phone || client.email || client.id,
    phone: client.phone || client.mobile || client.mobileNumber || client.contactNumber || "",
    email: client.email || "",
    branchId: client.branchId || "",
    totalSpend: Number(client.totalSpend || 0),
    visitCount: Number(client.visitCount || 0),
    walletBalance: Number(client.walletBalance || 0),
    loyaltyPoints: Number(client.loyaltyPoints || 0),
    lastVisitAt: client.lastVisitAt || "",
    tags: arrayValue(client.tags)
  };
}

let clientReferenceTargetCache;

function clientReferenceTargets() {
  if (clientReferenceTargetCache) return clientReferenceTargetCache;
  const targets = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name: table } of tables) {
    if (!safeIdentifier(table)) continue;
    const columns = columnsFor(table);
    const tenantColumn = columns.includes("tenantId") ? "tenantId" : columns.includes("tenant_id") ? "tenant_id" : "";
    if (!tenantColumn || !safeIdentifier(tenantColumn)) continue;
    const referenceColumns = ["clientId", "client_id", "customerId", "customer_id", "primaryAccountId"]
      .filter((column) => columns.includes(column))
      .filter((column) => table !== "clients" || column === "primaryAccountId")
      .filter(safeIdentifier);
    for (const column of referenceColumns) targets.push({ table, column, tenantColumn });
  }
  clientReferenceTargetCache = targets;
  return targets;
}

function reassignClientReferences(duplicateId, primaryId, tenantId) {
  const updates = [];
  for (const { table, column, tenantColumn } of clientReferenceTargets()) {
    const statement = db.prepare(`UPDATE ${table} SET ${column} = @primaryId WHERE ${tenantColumn} = @tenantId AND ${column} = @duplicateId`);
    const result = statement.run({ primaryId, duplicateId, tenantId });
    if (result.changes) updates.push({ table, column, rows: result.changes });
  }
  return updates;
}

function mergedClientPayload(primary, duplicates) {
  const clients = [primary, ...duplicates];
  const latestVisit = clients.map((client) => client.lastVisitAt).filter(Boolean).sort().at(-1) || primary.lastVisitAt || "";
  const payload = {
    name: primary.name || duplicates.find((client) => client.name)?.name || primary.phone || primary.email || primary.id,
    phone: primary.phone || duplicates.find((client) => client.phone)?.phone || "",
    email: primary.email || duplicates.find((client) => client.email)?.email || "",
    gender: primary.gender || duplicates.find((client) => client.gender)?.gender || "",
    birthday: primary.birthday || duplicates.find((client) => client.birthday)?.birthday || "",
    anniversary: primary.anniversary || duplicates.find((client) => client.anniversary)?.anniversary || "",
    membershipId: primary.membershipId || duplicates.find((client) => client.membershipId)?.membershipId || "",
    tags: uniqueArray(clients.flatMap((client) => arrayValue(client.tags))),
    notes: uniqueText([
      primary.notes,
      duplicates.map((client) => client.notes).filter(Boolean).join("\n"),
      `Merged duplicate clients: ${duplicates.map((client) => client.id).join(", ")}`
    ]),
    walletBalance: clients.reduce((total, client) => total + Number(client.walletBalance || 0), 0),
    loyaltyPoints: clients.reduce((total, client) => total + Number(client.loyaltyPoints || 0), 0),
    totalSpend: clients.reduce((total, client) => total + Number(client.totalSpend || 0), 0),
    visitCount: clients.reduce((total, client) => total + Number(client.visitCount || 0), 0),
    lastVisitAt: latestVisit,
    visitHistory: uniqueArray(clients.flatMap((client) => arrayValue(client.visitHistory))),
    purchaseHistory: uniqueArray(clients.flatMap((client) => arrayValue(client.purchaseHistory))),
    whatsappHistory: uniqueArray(clients.flatMap((client) => arrayValue(client.whatsappHistory))),
    consentForms: uniqueArray(clients.flatMap((client) => arrayValue(client.consentForms)))
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function uniqueArray(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueText(parts = []) {
  return [...new Set(parts.map((part) => String(part || "").trim()).filter(Boolean))].join("\n");
}

function safeIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ""));
}
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
