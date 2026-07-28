import { badRequest, notFound } from "../utils/app-error.js";
import { repositories } from "../repositories/repository-registry.js";
import { tenantService } from "./tenant.service.js";
import { whatsappAutomationService } from "./whatsapp-automation.service.js";
import { customerNotificationService } from "./customer-notification.service.js";

const STATUSES = new Set(["waiting", "offered", "booked", "expired", "cancelled"]);

const now = () => new Date().toISOString();
const makeId = () => `wle_${crypto.randomUUID().slice(0, 10)}`;

function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {}, "waitlist");
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function text(value = "") {
  return String(value || "").trim();
}

function iso(value, field) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw badRequest(`${field} must be a valid ISO datetime`, { field });
  return date.toISOString();
}

function firstServiceId(slot = {}) {
  if (slot.serviceId) return text(slot.serviceId);
  const serviceIds = Array.isArray(slot.serviceIds) ? slot.serviceIds : Array.isArray(slot.services) ? slot.services : [];
  return text(serviceIds[0]);
}

function phoneForClient(client = {}) {
  return text(client.phone || client.mobile || client.whatsapp || client.whatsappNumber);
}

export class WaitlistService {
  add(payload = {}, access) {
    const branchId = text(payload.branchId || access?.branchId);
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const clientId = text(payload.clientId);
    if (!clientId) throw badRequest("clientId is required", { field: "clientId" });
    const status = text(payload.status || "waiting").toLowerCase();
    if (!STATUSES.has(status)) throw badRequest("Invalid waitlist status");
    const windowStart = iso(payload.windowStart, "windowStart");
    const windowEnd = iso(payload.windowEnd, "windowEnd");
    if (windowStart && windowEnd && windowStart >= windowEnd) throw badRequest("windowStart must be before windowEnd");
    return repositories.waitlistEntries.create(
      {
        id: payload.id || makeId(),
        branchId,
        clientId,
        serviceId: text(payload.serviceId),
        staffId: text(payload.staffId),
        preferredDate: text(payload.preferredDate).slice(0, 10),
        windowStart,
        windowEnd,
        priority: Number(payload.priority || 0),
        status,
        offeredAt: ""
      },
      scope(access, branchId)
    );
  }

  list(query = {}, access) {
    const branchId = text(query.branchId);
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const status = text(query.status).toLowerCase();
    if (status && !STATUSES.has(status)) throw badRequest("Invalid waitlist status");
    return repositories.waitlistEntries.list(
      {
        ...query,
        branchId: branchId || query.branchId,
        status: status || query.status,
        limit: Number(query.limit || 100)
      },
      scope(access, branchId)
    );
  }

  cancel(id, access) {
    const entry = repositories.waitlistEntries.getById(id, scope(access));
    if (!entry) throw notFound("Waitlist entry not found");
    if (entry.branchId) tenantService.assertBranchAccess(access, entry.branchId);
    return repositories.waitlistEntries.update(id, { status: "cancelled" }, scope(access, entry.branchId));
  }

  autoFillForFreedSlot(slot = {}, access) {
    const branchId = text(slot.branchId || access?.branchId);
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const serviceId = firstServiceId(slot);
    const startAt = iso(slot.startAt, "startAt");
    const endAt = iso(slot.endAt, "endAt");
    if (!serviceId || !startAt || !endAt) return null;
    const matches = repositories.waitlistEntries.findMatchesForSlot(scope(access, branchId), {
      serviceId,
      staffId: text(slot.staffId),
      startAt,
      endAt
    });
    const entry = matches[0];
    if (!entry) return null;
    const offered = repositories.waitlistEntries.update(entry.id, {
      status: "offered",
      offeredAt: now()
    }, scope(access, entry.branchId || branchId));
    customerNotificationService.safeCreate({
      tenantId: access.tenantId,
      branchId: offered.branchId || branchId,
      customerId: offered.clientId,
      type: "waitlist_slot_available",
      category: "bookings",
      title: "A slot is available",
      body: `A preferred appointment slot is available on ${new Date(startAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}.`,
      data: { waitlistEntryId: offered.id, serviceId, staffId: slot.staffId || "", startAt, endAt },
      deepLink: "/tabs/bookings",
      sourceType: "waitlist",
      sourceId: offered.id,
      eventKey: `waitlist:${offered.id}:offered:${startAt}`
    });
    const notification = this.sendOfferNotification(offered, { ...slot, serviceId, startAt, endAt, branchId }, access);
    return { ...offered, notification };
  }

  sendOfferNotification(entry, slot, access) {
    const client = repositories.clients.getById(entry.clientId, scope(access));
    const phone = phoneForClient(client);
    if (!phone) return null;
    const thread = whatsappAutomationService.ensureThread({
      phone,
      displayName: client?.name || entry.clientId,
      client,
      branchId: entry.branchId || slot.branchId || "",
      source: "waitlist-auto-fill"
    }, access);
    return whatsappAutomationService.createOutbound(thread, {
      eventType: "waitlist-slot-offer",
      intent: "booking_offer",
      templateKey: "waitlist_slot_offer",
      body: `A preferred appointment slot is now available on ${new Date(slot.startAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. Reply to confirm this booking.`,
      metadata: {
        waitlistEntryId: entry.id,
        serviceId: slot.serviceId,
        staffId: slot.staffId || "",
        startAt: slot.startAt,
        endAt: slot.endAt
      }
    }, access);
  }
}

export const waitlistService = new WaitlistService();
