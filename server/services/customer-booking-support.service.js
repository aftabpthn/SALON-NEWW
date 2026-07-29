import { db } from "../db.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { createCustomerCareTicket } from "./customer-care-ai.service.js";
import { ensureCustomerBookingSupportSchema } from "./customer-booking-support-schema.service.js";

const CATEGORIES = new Set(["reschedule", "cancellation", "payment", "salon_unavailable", "other"]);
const CONTACT_METHODS = new Set(["phone", "email", "in_app"]);
const PRIORITIES = new Set(["low", "medium", "high"]);
const STATUSES = new Set(["open", "pending", "in_progress", "resolved", "closed", "escalated"]);
const FORBIDDEN_BODY_FIELDS = ["tenantId", "branchId", "customerId", "customerName", "customerPhone", "userId", "bookingId"];

export function createCustomerBookingSupportTicket(access, bookingId, payload = {}) {
  ensureCustomerBookingSupportSchema();
  rejectClientScope(payload);

  const tenantId = String(access?.tenantId || "").trim();
  const customerId = String(access?.userId || "").trim();
  const normalizedBookingId = String(bookingId || "").trim();
  const category = normalizedAllowlisted(payload.category, CATEGORIES, "category");
  const message = requiredMessage(payload.message);
  const preferredContact = optionalAllowlisted(payload.preferredContact, CONTACT_METHODS, "preferredContact", "in_app");
  const priority = optionalAllowlisted(payload.priority, PRIORITIES, "priority", "medium");

  const appointment = db.prepare(`SELECT id, branchId FROM appointments
    WHERE id = @bookingId AND tenantId = @tenantId AND clientId = @customerId
    LIMIT 1`).get({ bookingId: normalizedBookingId, tenantId, customerId });
  if (!appointment) throw notFound("Booking not found");

  const customer = db.prepare(`SELECT name, phone FROM clients
    WHERE id = @customerId AND tenantId = @tenantId
    LIMIT 1`).get({ customerId, tenantId });
  if (!customer) throw notFound("Booking not found");

  const create = db.transaction(() => {
    const ticket = createCustomerCareTicket({
      branchId: appointment.branchId,
      customerId,
      customerName: customer.name || "",
      customerPhone: customer.phone || "",
      topic: category,
      summary: message,
      priority,
      status: "open"
    }, { tenantId, branchId: appointment.branchId, userId: customerId, role: "customer" });
    const audit = Array.isArray(ticket.audit) ? ticket.audit : [];
    audit.push({
      action: "customer_booking_support_created",
      at: ticket.createdAt,
      role: "customer",
      bookingId: normalizedBookingId,
      category,
      preferredContact
    });
    db.prepare(`UPDATE customerCareAiTickets
      SET bookingId = @bookingId, auditJson = @auditJson
      WHERE id = @id AND tenantId = @tenantId AND customerId = @customerId`).run({
      bookingId: normalizedBookingId,
      auditJson: JSON.stringify(audit),
      id: ticket.id,
      tenantId,
      customerId
    });
    return ticketDto({ ...ticket, bookingId: normalizedBookingId, audit });
  });

  return create();
}

export function listCustomerBookingSupportTickets(access, query = {}) {
  ensureCustomerBookingSupportSchema();
  const tenantId = String(access?.tenantId || "").trim();
  const customerId = String(access?.userId || "").trim();
  const status = optionalStatus(query.status);
  const limit = normalizedLimit(query.limit);
  const statusClause = status ? " AND status = @status" : "";
  const rows = db.prepare(`SELECT id, bookingId, branchId, topic, summary, priority, status, auditJson, createdAt, updatedAt
    FROM customerCareAiTickets
    WHERE tenantId = @tenantId AND customerId = @customerId AND bookingId <> ''${statusClause}
    ORDER BY datetime(updatedAt) DESC
    LIMIT @limit`).all({ tenantId, customerId, status, limit });
  return { items: rows.map(ticketDto) };
}

function ticketDto(row) {
  const audit = Array.isArray(row.audit) ? row.audit : safeJson(row.auditJson, []);
  const supportContext = [...audit].reverse().find((entry) => entry?.action === "customer_booking_support_created");
  return {
    id: row.id,
    bookingId: row.bookingId || supportContext?.bookingId || "",
    branchId: row.branchId,
    category: row.topic,
    message: row.summary,
    preferredContact: supportContext?.preferredContact || "in_app",
    priority: row.priority,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function rejectClientScope(payload) {
  const field = FORBIDDEN_BODY_FIELDS.find((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (field) throw badRequest(`${field} must not be provided`);
}

function normalizedAllowlisted(value, allowed, field) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!allowed.has(normalized)) throw badRequest(`Invalid ${field}`, { allowed: [...allowed] });
  return normalized;
}

function optionalAllowlisted(value, allowed, field, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return normalizedAllowlisted(value, allowed, field);
}

function requiredMessage(value) {
  if (typeof value !== "string") throw badRequest("message is required");
  const message = value.trim();
  if (!message || message.length > 1200) throw badRequest("message must be between 1 and 1200 characters");
  return message;
}

function optionalStatus(value) {
  if (value === undefined || value === null || value === "") return "";
  return normalizedAllowlisted(value, STATUSES, "status");
}

function normalizedLimit(value) {
  if (value === undefined || value === null || value === "") return 20;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw badRequest("limit must be a positive integer");
  return Math.min(limit, 100);
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}
