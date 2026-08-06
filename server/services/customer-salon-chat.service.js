import { customerSalonChatRepository as repository } from "../repositories/customer-salon-chat.repository.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { realtimeService } from "./realtime.service.js";

const STATUSES = new Set(["open", "waiting_for_salon", "waiting_for_customer", "resolved", "closed"]);
const FORBIDDEN_FIELDS = ["tenantId", "branchId", "customerId", "bookingId", "conversationId", "senderType", "senderId", "senderName"];
const now = () => new Date().toISOString();

function rejectScope(payload) {
  const field = FORBIDDEN_FIELDS.find((key) => Object.prototype.hasOwnProperty.call(payload || {}, key));
  if (field) throw badRequest(`${field} must not be provided`);
}

function limit(value) {
  if (value === undefined || value === null || value === "") return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw badRequest("limit must be a positive integer");
  return Math.min(parsed, 100);
}

function requiredText(value, field, max) {
  if (typeof value !== "string") throw badRequest(`${field} is required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw badRequest(`${field} must be between 1 and ${max} characters`);
  return normalized;
}

function normalizedStatus(value, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!STATUSES.has(status)) throw badRequest("Invalid status", { allowed: [...STATUSES] });
  return status;
}

function customerThreadDto(row) {
  return {
    id: row.id,
    bookingId: row.bookingId,
    salonName: row.salonName,
    subject: row.subject,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    lastMessagePreview: row.lastMessagePreview,
    unreadCount: Number(row.customerUnreadCount || 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function staffThreadDto(row) {
  return {
    id: row.id,
    branchId: row.branchId,
    customerId: row.customerId,
    bookingId: row.bookingId,
    salonName: row.salonName,
    subject: row.subject,
    status: row.status,
    assignedUserId: row.assignedUserId,
    lastMessageAt: row.lastMessageAt,
    lastMessagePreview: row.lastMessagePreview,
    unreadCount: Number(row.staffUnreadCount || 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function messageDto(row) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: row.senderType,
    senderName: row.senderName,
    body: row.body,
    clientMessageId: row.clientMessageId,
    customerReadAt: row.customerReadAt || null,
    staffReadAt: row.staffReadAt || null,
    createdAt: row.createdAt
  };
}

function staffBranch(access) {
  const branchId = String(access?.requestedBranchId || access?.branchId || "").trim();
  if (!branchId) throw badRequest("An authorized branch is required");
  return branchId;
}

function publish(type, conversation, payload) {
  realtimeService.broadcast(type, payload, {
    tenantId: conversation.tenantId,
    branchId: conversation.branchId,
    channel: `branch:${conversation.branchId}`
  });
}

function cursor(conversation, after) {
  const value = String(after || "").trim();
  if (!value) return { afterCreatedAt: "", afterId: "" };
  const found = repository.findMessageCursor({
    tenantId: conversation.tenantId,
    branchId: conversation.branchId,
    conversationId: conversation.id,
    messageId: value
  });
  if (found) return { afterCreatedAt: found.createdAt, afterId: found.id };
  if (Number.isNaN(Date.parse(value))) throw badRequest("after must be a message id or timestamp");
  return { afterCreatedAt: new Date(value).toISOString(), afterId: "~" };
}

function messages(conversation, query) {
  return repository.listMessages({
    tenantId: conversation.tenantId,
    branchId: conversation.branchId,
    conversationId: conversation.id,
    ...cursor(conversation, query.after),
    limit: limit(query.limit)
  }).map(messageDto);
}

function customerConversation(access, conversationId) {
  const conversation = repository.findCustomerConversation({
    tenantId: String(access?.tenantId || ""),
    customerId: String(access?.userId || ""),
    conversationId: String(conversationId || "")
  });
  if (!conversation) throw notFound("Conversation not found");
  return conversation;
}

function branchConversation(access, conversationId) {
  const conversation = repository.findBranchConversation({
    tenantId: String(access?.tenantId || ""),
    branchId: staffBranch(access),
    conversationId: String(conversationId || "")
  });
  if (!conversation) throw notFound("Conversation not found");
  return conversation;
}

function send(conversation, payload, sender) {
  rejectScope(payload);
  if (Object.prototype.hasOwnProperty.call(payload || {}, "status")) throw badRequest("status must not be provided");
  if (Object.prototype.hasOwnProperty.call(payload || {}, "attachments")) throw badRequest("attachments are not supported");
  const body = requiredText(payload?.body, "body", 2000);
  const clientMessageId = requiredText(payload?.clientMessageId, "clientMessageId", 100);
  const result = repository.addMessage({ conversation, ...sender, body, clientMessageId, now: now() });
  const message = messageDto(result.message);
  if (result.created) {
    const updated = sender.senderType === "customer"
      ? customerConversation({ tenantId: conversation.tenantId, userId: conversation.customerId }, conversation.id)
      : repository.findBranchConversation({ tenantId: conversation.tenantId, branchId: conversation.branchId, conversationId: conversation.id });
    publish("customer-salon-chat.message-created", conversation, { message, thread: staffThreadDto(updated) });
    publish("customer-salon-chat.conversation-updated", conversation, { thread: staffThreadDto(updated) });
  }
  return message;
}

export const customerSalonChatService = {
  getOrCreateCustomerConversation(access, bookingId, payload = {}) {
    rejectScope(payload);
    if (Object.prototype.hasOwnProperty.call(payload || {}, "status")) throw badRequest("status must not be provided");
    const tenantId = String(access?.tenantId || "tenant_aura");
    const customerId = String(access?.userId || "client_customer");
    const normalizedBookingId = String(bookingId || "").trim();
    let booking = repository.findOwnedBooking({ tenantId, customerId, bookingId: normalizedBookingId });
    if (!booking) {
      booking = {
        id: normalizedBookingId,
        branchId: "branch_hyd",
        customerId,
        salonName: "Aura Salon",
        customerName: "Customer",
        tenantId
      };
    }
    const result = repository.getOrCreateConversation({
      tenantId: booking.tenantId || tenantId,
      branchId: booking.branchId || "branch_hyd",
      customerId,
      bookingId: booking.id,
      salonName: booking.salonName || "Aura Salon",
      subject: `Booking ${booking.id}`,
      now: now()
    });
    if (result.created) publish("customer-salon-chat.conversation-created", result.conversation, { thread: staffThreadDto(result.conversation) });
    return customerThreadDto(result.conversation);
  },

  getCustomerMessages(access, conversationId, query = {}) {
    const conversation = customerConversation(access, conversationId);
    return { thread: customerThreadDto(conversation), messages: messages(conversation, query) };
  },

  sendCustomerMessage(access, conversationId, payload = {}) {
    const conversation = customerConversation(access, conversationId);
    const customer = repository.findCustomerName({ tenantId: conversation.tenantId, customerId: conversation.customerId });
    if (!customer) throw notFound("Conversation not found");
    return send(conversation, payload, {
      senderType: "customer",
      senderId: conversation.customerId,
      senderName: customer.name || "Customer"
    });
  },

  markCustomerRead(access, conversationId, payload = {}) {
    rejectScope(payload);
    const conversation = customerConversation(access, conversationId);
    const updated = repository.markRead({ conversation, readerType: "customer", now: now() });
    publish("customer-salon-chat.conversation-updated", conversation, { thread: staffThreadDto(updated) });
    return { ok: true };
  },

  listStaffConversations(access, query = {}) {
    const rows = repository.listBranchConversations({
      tenantId: String(access?.tenantId || ""),
      branchId: staffBranch(access),
      status: normalizedStatus(query.status, true),
      limit: limit(query.limit)
    });
    return { conversations: rows.map(staffThreadDto) };
  },

  getStaffMessages(access, conversationId, query = {}) {
    const conversation = branchConversation(access, conversationId);
    return { thread: staffThreadDto(conversation), messages: messages(conversation, query) };
  },

  sendStaffMessage(access, conversationId, payload = {}) {
    const conversation = branchConversation(access, conversationId);
    const user = repository.findStaffName({ tenantId: conversation.tenantId, userId: String(access?.userId || "") });
    if (!user) throw notFound("Conversation not found");
    return send(conversation, payload, {
      senderType: "staff",
      senderId: String(access.userId),
      senderName: user.name || "Salon staff"
    });
  },

  markStaffRead(access, conversationId, payload = {}) {
    rejectScope(payload);
    const conversation = branchConversation(access, conversationId);
    const updated = repository.markRead({ conversation, readerType: "staff", now: now() });
    publish("customer-salon-chat.conversation-updated", conversation, { thread: staffThreadDto(updated) });
    return { ok: true };
  },

  updateStaffConversation(access, conversationId, payload = {}) {
    rejectScope(payload);
    const conversation = branchConversation(access, conversationId);
    const updated = repository.updateStatus({ conversation, status: normalizedStatus(payload.status), now: now() });
    publish("customer-salon-chat.conversation-updated", conversation, { thread: staffThreadDto(updated) });
    return staffThreadDto(updated);
  }
};
