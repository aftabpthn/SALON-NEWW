import { db } from "../db.js";

let schemaReady = false;

export function ensureTeamChatSchema() {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS staffPrivateConversations (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      staffUserId TEXT NOT NULL,
      ownerUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, staffUserId, ownerUserId)
    );
    CREATE TABLE IF NOT EXISTS staffPrivateConversationParticipants (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      userId TEXT NOT NULL,
      participantRole TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, conversationId, userId)
    );
    CREATE TABLE IF NOT EXISTS staffPrivateChatMessages (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      senderUserId TEXT NOT NULL,
      senderName TEXT DEFAULT '',
      body TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_staff_private_chat_participant
      ON staffPrivateConversationParticipants(tenantId, branchId, userId, conversationId);
    CREATE INDEX IF NOT EXISTS idx_staff_private_chat_messages
      ON staffPrivateChatMessages(tenantId, branchId, conversationId, createdAt);
  `);
  schemaReady = true;
}
