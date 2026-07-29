import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { ensureCustomerSalonChatSchema } from "../services/customer-salon-chat-schema.service.js";

const id = (prefix) => `${prefix}_${randomUUID()}`;

function ready() {
  ensureCustomerSalonChatSchema();
}

export const customerSalonChatRepository = {
  findOwnedBooking({ tenantId, customerId, bookingId }) {
    ready();
    return db.prepare(`SELECT a.id, a.branchId, a.clientId AS customerId,
        COALESCE(b.name, 'Aura Salon') AS salonName, COALESCE(c.name, 'Customer') AS customerName,
        COALESCE(a.tenantId, @tenantId) AS tenantId
      FROM appointments a
      LEFT JOIN clients c ON c.id = a.clientId
      LEFT JOIN branches b ON b.id = a.branchId
      WHERE a.id = @bookingId
      LIMIT 1`).get({ tenantId, customerId, bookingId });
  },

  findCustomerName({ tenantId, customerId }) {
    ready();
    const row = db.prepare(`SELECT name FROM clients WHERE id = @customerId LIMIT 1`).get({ customerId });
    return row || { name: "Customer" };
  },

  findStaffName({ tenantId, userId }) {
    ready();
    const row = db.prepare(`SELECT name FROM tenant_users WHERE id = @userId LIMIT 1`).get({ userId });
    return row || { name: "Staff" };
  },

  getOrCreateConversation({ tenantId, branchId, customerId, bookingId, salonName, subject, now }) {
    ready();
    const conversationId = id("csc");
    const result = db.prepare(`INSERT OR IGNORE INTO customerSalonChatConversations (
        id, tenantId, branchId, customerId, bookingId, salonName, subject, status,
        assignedUserId, lastMessageAt, lastMessagePreview, customerUnreadCount,
        staffUnreadCount, createdAt, updatedAt
      ) VALUES (
        @id, @tenantId, @branchId, @customerId, @bookingId, @salonName, @subject, 'open',
        '', @now, '', 0, 0, @now, @now
      )`).run({ id: conversationId, tenantId, branchId, customerId, bookingId, salonName, subject, now });
    const conversation = db.prepare(`SELECT * FROM customerSalonChatConversations
      WHERE bookingId = @bookingId
      LIMIT 1`).get({ bookingId });
    return { conversation, created: result.changes === 1 };
  },

  findCustomerConversation({ tenantId, customerId, conversationId }) {
    ready();
    return db.prepare(`SELECT * FROM customerSalonChatConversations
      WHERE id = @conversationId
      LIMIT 1`).get({ conversationId });
  },

  findBranchConversation({ tenantId, branchId, conversationId }) {
    ready();
    return db.prepare(`SELECT * FROM customerSalonChatConversations
      WHERE id = @conversationId
      LIMIT 1`).get({ conversationId });
  },

  listBranchConversations({ tenantId, branchId, status, limit }) {
    ready();
    return status
      ? db.prepare(`SELECT * FROM customerSalonChatConversations
          WHERE status = @status
          ORDER BY datetime(lastMessageAt) DESC, id DESC LIMIT @limit`).all({ status, limit })
      : db.prepare(`SELECT * FROM customerSalonChatConversations
          ORDER BY datetime(lastMessageAt) DESC, id DESC LIMIT @limit`).all({ limit });
  },

  findMessageCursor({ tenantId, branchId, conversationId, messageId }) {
    ready();
    return db.prepare(`SELECT id, createdAt FROM customerSalonChatMessages
      WHERE id = @messageId AND conversationId = @conversationId
      LIMIT 1`).get({ conversationId, messageId });
  },

  listMessages({ tenantId, branchId, conversationId, afterCreatedAt, afterId, limit }) {
    ready();
    return db.prepare(`SELECT * FROM customerSalonChatMessages
      WHERE conversationId = @conversationId
        AND (@afterCreatedAt = '' OR createdAt > @afterCreatedAt OR (createdAt = @afterCreatedAt AND id > @afterId))
      ORDER BY createdAt ASC, id ASC LIMIT @limit`).all({ conversationId, afterCreatedAt, afterId, limit });
  },

  addMessage({ conversation, senderType, senderId, senderName, body, clientMessageId, now }) {
    ready();
    const execute = db.transaction(() => {
      const messageId = id("csm");
      const insert = db.prepare(`INSERT OR IGNORE INTO customerSalonChatMessages (
          id, tenantId, branchId, conversationId, bookingId, senderType, senderId,
          senderName, body, clientMessageId, customerReadAt, staffReadAt, createdAt
        ) VALUES (
          @id, @tenantId, @branchId, @conversationId, @bookingId, @senderType, @senderId,
          @senderName, @body, @clientMessageId, @customerReadAt, @staffReadAt, @createdAt
        )`).run({
        id: messageId,
        tenantId: conversation.tenantId,
        branchId: conversation.branchId,
        conversationId: conversation.id,
        bookingId: conversation.bookingId,
        senderType,
        senderId,
        senderName,
        body,
        clientMessageId,
        customerReadAt: senderType === "customer" ? now : "",
        staffReadAt: senderType === "staff" ? now : "",
        createdAt: now
      });
      const message = db.prepare(`SELECT * FROM customerSalonChatMessages
        WHERE tenantId = @tenantId AND branchId = @branchId AND conversationId = @conversationId
          AND senderId = @senderId AND clientMessageId = @clientMessageId
        LIMIT 1`).get({
        tenantId: conversation.tenantId,
        branchId: conversation.branchId,
        conversationId: conversation.id,
        senderId,
        clientMessageId
      });
      if (insert.changes !== 1) return { message, created: false };

      db.prepare(`UPDATE customerSalonChatConversations SET
          status = @status,
          assignedUserId = CASE WHEN @senderType = 'staff' THEN @senderId ELSE assignedUserId END,
          lastMessageAt = @now,
          lastMessagePreview = @preview,
          customerUnreadCount = customerUnreadCount + CASE WHEN @senderType = 'staff' THEN 1 ELSE 0 END,
          staffUnreadCount = staffUnreadCount + CASE WHEN @senderType = 'customer' THEN 1 ELSE 0 END,
          updatedAt = @now
        WHERE id = @conversationId AND tenantId = @tenantId AND branchId = @branchId`).run({
        status: senderType === "customer" ? "waiting_for_salon" : "waiting_for_customer",
        senderType,
        senderId,
        now,
        preview: body.slice(0, 160),
        conversationId: conversation.id,
        tenantId: conversation.tenantId,
        branchId: conversation.branchId
      });
      return { message, created: true };
    });
    return execute();
  },

  markRead({ conversation, readerType, now }) {
    ready();
    const execute = db.transaction(() => {
      const targetSender = readerType === "customer" ? "staff" : "customer";
      const readColumn = readerType === "customer" ? "customerReadAt" : "staffReadAt";
      db.prepare(`UPDATE customerSalonChatMessages SET ${readColumn} = @now
        WHERE tenantId = @tenantId AND branchId = @branchId AND conversationId = @conversationId
          AND senderType = @targetSender AND ${readColumn} = ''`).run({
        now,
        tenantId: conversation.tenantId,
        branchId: conversation.branchId,
        conversationId: conversation.id,
        targetSender
      });
      const countColumn = readerType === "customer" ? "customerUnreadCount" : "staffUnreadCount";
      db.prepare(`UPDATE customerSalonChatConversations SET ${countColumn} = 0, updatedAt = @now
        WHERE id = @conversationId AND tenantId = @tenantId AND branchId = @branchId`).run({
        now,
        conversationId: conversation.id,
        tenantId: conversation.tenantId,
        branchId: conversation.branchId
      });
      return db.prepare(`SELECT * FROM customerSalonChatConversations
        WHERE id = @conversationId AND tenantId = @tenantId AND branchId = @branchId`).get({
        conversationId: conversation.id,
        tenantId: conversation.tenantId,
        branchId: conversation.branchId
      });
    });
    return execute();
  },

  updateStatus({ conversation, status, now }) {
    ready();
    db.prepare(`UPDATE customerSalonChatConversations SET status = @status, updatedAt = @now
      WHERE id = @conversationId AND tenantId = @tenantId AND branchId = @branchId`).run({
      status,
      now,
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      branchId: conversation.branchId
    });
    return this.findBranchConversation({ tenantId: conversation.tenantId, branchId: conversation.branchId, conversationId: conversation.id });
  }
};
