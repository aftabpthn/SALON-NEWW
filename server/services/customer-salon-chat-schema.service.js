import { db } from "../db.js";

let ensured = false;

export function ensureCustomerSalonChatSchema() {
  if (ensured) return;
  const run = db.transaction(() => {
    db.prepare(`CREATE TABLE IF NOT EXISTS customerSalonChatConversations (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      customerId TEXT NOT NULL,
      bookingId TEXT NOT NULL,
      salonName TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting_for_salon','waiting_for_customer','resolved','closed')),
      assignedUserId TEXT NOT NULL DEFAULT '',
      lastMessageAt TEXT NOT NULL DEFAULT '',
      lastMessagePreview TEXT NOT NULL DEFAULT '',
      customerUnreadCount INTEGER NOT NULL DEFAULT 0,
      staffUnreadCount INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, customerId, bookingId)
    )`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_customerSalonChatConversations_customer
      ON customerSalonChatConversations(tenantId, customerId, lastMessageAt)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_customerSalonChatConversations_branch_status_lastMessage
      ON customerSalonChatConversations(tenantId, branchId, status, lastMessageAt)`).run();

    db.prepare(`CREATE TABLE IF NOT EXISTS customerSalonChatMessages (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      bookingId TEXT NOT NULL,
      senderType TEXT NOT NULL CHECK(senderType IN ('customer','staff','system')),
      senderId TEXT NOT NULL,
      senderName TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      clientMessageId TEXT NOT NULL,
      customerReadAt TEXT NOT NULL DEFAULT '',
      staffReadAt TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, conversationId, senderId, clientMessageId),
      FOREIGN KEY(conversationId) REFERENCES customerSalonChatConversations(id)
    )`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_customerSalonChatMessages_conversation_date
      ON customerSalonChatMessages(tenantId, branchId, conversationId, createdAt, id)`).run();
  });
  run();
  ensured = true;
}

ensureCustomerSalonChatSchema();
