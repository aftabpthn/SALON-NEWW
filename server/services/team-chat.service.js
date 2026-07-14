import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { realtimeService } from "./realtime.service.js";
import { ensureTeamChatSchema } from "./team-chat-schema.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;

function branchIdFor(access) {
  const branchId = access.requestedBranchId || access.branchId || "";
  if (!branchId) throw badRequest("Branch context is required for team chat");
  return branchId;
}

function currentUser(access) {
  const user = db.prepare(`SELECT id, name, role, staffId FROM tenant_users
    WHERE tenantId = @tenantId AND id = @userId AND status = 'active'`).get({
    tenantId: access.tenantId,
    userId: access.userId
  });
  if (!user) throw notFound("Active chat user not found");
  return user;
}

function ensureTeamThread(tenantId, branchId, userId) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staffChatThreads (
      id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, branchId TEXT NOT NULL, title TEXT NOT NULL,
      channel TEXT DEFAULT 'branch', createdBy TEXT DEFAULT '', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staffChatMessages (
      id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, branchId TEXT NOT NULL, threadId TEXT NOT NULL,
      senderStaffId TEXT NOT NULL, senderName TEXT DEFAULT '', body TEXT NOT NULL, createdAt TEXT NOT NULL,
      readByJson TEXT DEFAULT '[]'
    );
  `);
  const existing = db.prepare(`SELECT * FROM staffChatThreads
    WHERE tenantId = @tenantId AND branchId = @branchId AND channel = 'branch'
    ORDER BY createdAt ASC LIMIT 1`).get({ tenantId, branchId });
  if (existing) return existing;
  const createdAt = now();
  const row = {
    id: makeId("thread"), tenantId, branchId, title: "Branch Team Chat", channel: "branch",
    createdBy: userId, createdAt, updatedAt: createdAt
  };
  db.prepare(`INSERT INTO staffChatThreads
    (id, tenantId, branchId, title, channel, createdBy, createdAt, updatedAt)
    VALUES (@id, @tenantId, @branchId, @title, @channel, @createdBy, @createdAt, @updatedAt)`).run(row);
  return row;
}

function privateConversation(conversationId, access, branchId) {
  return db.prepare(`SELECT c.* FROM staffPrivateConversations c
    WHERE c.id = @conversationId AND c.tenantId = @tenantId AND c.branchId = @branchId
      AND EXISTS (
        SELECT 1 FROM staffPrivateConversationParticipants p
        WHERE p.tenantId = c.tenantId AND p.branchId = c.branchId
          AND p.conversationId = c.id AND p.userId = @userId
      )`).get({ conversationId, tenantId: access.tenantId, branchId, userId: access.userId });
}

function participantIds(conversationId, tenantId, branchId) {
  return db.prepare(`SELECT userId FROM staffPrivateConversationParticipants
    WHERE tenantId = @tenantId AND branchId = @branchId AND conversationId = @conversationId
    ORDER BY participantRole DESC, userId ASC`).all({ tenantId, branchId, conversationId }).map((row) => row.userId);
}

function privateTitle(row, tenantId, viewerUserId) {
  if (viewerUserId !== row.ownerUserId) return "Owner chat";
  const staff = db.prepare(`SELECT name FROM tenant_users
    WHERE tenantId = @tenantId AND id = @staffUserId AND status = 'active'`).get({
      tenantId,
      staffUserId: row.staffUserId
    });
  return staff?.name ? `${staff.name} · Private` : "Staff conversation · Private";
}

function presentPrivate(row, participantUserIds, tenantId, viewerUserId, messageCount = 0, lastMessageAt = "") {
  return {
    id: row.id,
    type: "private-owner",
    title: privateTitle(row, tenantId, viewerUserId),
    branchId: row.branchId,
    participantUserIds,
    messageCount: Number(messageCount || 0),
    lastMessageAt: lastMessageAt || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function auditMessage(row, access, type) {
  repositories.auditLogs.create({
    id: makeId("audit"),
    branchId: row.branchId,
    actorUserId: access.userId,
    action: "staff.team_chat_message_sent",
    entityType: type === "team" ? "staffChatMessages" : "staffPrivateChatMessages",
    entityId: row.id,
    severity: "info",
    details: { conversationId: row.conversationId || row.threadId, conversationType: type }
  }, { tenantId: access.tenantId });
}

export const teamChatService = {
  listConversations(access) {
    ensureTeamChatSchema();
    const branchId = branchIdFor(access);
    const team = ensureTeamThread(access.tenantId, branchId, access.userId);
    const teamStats = db.prepare(`SELECT COUNT(*) AS messageCount, MAX(createdAt) AS lastMessageAt
      FROM staffChatMessages WHERE tenantId = @tenantId AND branchId = @branchId AND threadId = @threadId`)
      .get({ tenantId: access.tenantId, branchId, threadId: team.id });
    const privateRows = db.prepare(`SELECT c.*, COUNT(m.id) AS messageCount, MAX(m.createdAt) AS lastMessageAt
      FROM staffPrivateConversations c
      JOIN staffPrivateConversationParticipants p
        ON p.tenantId = c.tenantId AND p.branchId = c.branchId AND p.conversationId = c.id
      LEFT JOIN staffPrivateChatMessages m
        ON m.tenantId = c.tenantId AND m.branchId = c.branchId AND m.conversationId = c.id
      WHERE c.tenantId = @tenantId AND c.branchId = @branchId AND p.userId = @userId
      GROUP BY c.id ORDER BY COALESCE(MAX(m.createdAt), c.updatedAt) DESC`).all({
        tenantId: access.tenantId, branchId, userId: access.userId
      });
    return [{
      id: team.id,
      type: "team",
      title: "Team chat",
      branchId,
      participantUserIds: null,
      messageCount: Number(teamStats.messageCount || 0),
      lastMessageAt: teamStats.lastMessageAt || "",
      createdAt: team.createdAt,
      updatedAt: team.updatedAt
    }, ...privateRows.map((row) => presentPrivate(
      row,
      participantIds(row.id, access.tenantId, branchId),
      access.tenantId,
      access.userId,
      row.messageCount,
      row.lastMessageAt
    ))];
  },

  getOrCreatePrivateOwner(access) {
    ensureTeamChatSchema();
    const branchId = branchIdFor(access);
    const user = currentUser(access);
    if (String(user.role).toLowerCase() === "owner") throw badRequest("Owner cannot create a private conversation with self");
    const owner = db.prepare(`SELECT id, name FROM tenant_users
      WHERE tenantId = @tenantId AND lower(role) = 'owner' AND status = 'active'
      ORDER BY createdAt ASC, id ASC LIMIT 1`).get({ tenantId: access.tenantId });
    if (!owner) throw notFound("Active owner not found");

    const create = db.transaction(() => {
      const existing = db.prepare(`SELECT * FROM staffPrivateConversations
        WHERE tenantId = @tenantId AND branchId = @branchId AND staffUserId = @staffUserId AND ownerUserId = @ownerUserId`)
        .get({ tenantId: access.tenantId, branchId, staffUserId: user.id, ownerUserId: owner.id });
      if (existing) return existing;
      const createdAt = now();
      const row = {
        id: makeId("private_chat"), tenantId: access.tenantId, branchId,
        staffUserId: user.id, ownerUserId: owner.id, createdAt, updatedAt: createdAt
      };
      db.prepare(`INSERT INTO staffPrivateConversations
        (id, tenantId, branchId, staffUserId, ownerUserId, createdAt, updatedAt)
        VALUES (@id, @tenantId, @branchId, @staffUserId, @ownerUserId, @createdAt, @updatedAt)`).run(row);
      const insertParticipant = db.prepare(`INSERT INTO staffPrivateConversationParticipants
        (id, tenantId, branchId, conversationId, userId, participantRole, createdAt)
        VALUES (@id, @tenantId, @branchId, @conversationId, @userId, @participantRole, @createdAt)`);
      insertParticipant.run({ id: makeId("chat_part"), tenantId: access.tenantId, branchId, conversationId: row.id, userId: user.id, participantRole: "staff", createdAt });
      insertParticipant.run({ id: makeId("chat_part"), tenantId: access.tenantId, branchId, conversationId: row.id, userId: owner.id, participantRole: "owner", createdAt });
      return row;
    });
    const row = create();
    return presentPrivate(row, participantIds(row.id, access.tenantId, branchId), access.tenantId, access.userId);
  },

  listMessages(conversationId, access) {
    ensureTeamChatSchema();
    const branchId = branchIdFor(access);
    const team = ensureTeamThread(access.tenantId, branchId, access.userId);
    if (conversationId === team.id) {
      return db.prepare(`SELECT * FROM (SELECT m.id, m.threadId AS conversationId, 'team' AS type,
        COALESCE((SELECT u.id FROM tenant_users u WHERE u.tenantId = m.tenantId
          AND (u.staffId = m.senderStaffId OR u.id = m.senderStaffId) ORDER BY u.id LIMIT 1), m.senderStaffId) AS senderUserId,
        m.senderName, m.body, m.createdAt
        FROM staffChatMessages m
        WHERE m.tenantId = @tenantId AND m.branchId = @branchId AND m.threadId = @conversationId
        ORDER BY m.createdAt DESC LIMIT 200) ORDER BY createdAt ASC`).all({ tenantId: access.tenantId, branchId, conversationId });
    }
    if (!privateConversation(conversationId, access, branchId)) throw notFound("Conversation not found");
    return db.prepare(`SELECT * FROM (SELECT id, conversationId, 'private-owner' AS type, senderUserId, senderName, body, createdAt
      FROM staffPrivateChatMessages
      WHERE tenantId = @tenantId AND branchId = @branchId AND conversationId = @conversationId
      ORDER BY createdAt DESC LIMIT 200) ORDER BY createdAt ASC`).all({ tenantId: access.tenantId, branchId, conversationId });
  },

  sendMessage(conversationId, payload, access) {
    ensureTeamChatSchema();
    const branchId = branchIdFor(access);
    const user = currentUser(access);
    const body = String(payload.body || payload.message || "").trim();
    if (!body) throw badRequest("Message body is required");
    if (body.length > 4000) throw badRequest("Message body must be 4000 characters or fewer");
    const team = ensureTeamThread(access.tenantId, branchId, access.userId);
    if (conversationId === team.id) {
      const row = {
        id: makeId("msg"), tenantId: access.tenantId, branchId, threadId: team.id,
        senderStaffId: user.staffId || user.id, senderName: user.name || "Staff", body,
        createdAt: now(), readByJson: JSON.stringify([user.staffId || user.id])
      };
      db.prepare(`INSERT INTO staffChatMessages
        (id, tenantId, branchId, threadId, senderStaffId, senderName, body, createdAt, readByJson)
        VALUES (@id, @tenantId, @branchId, @threadId, @senderStaffId, @senderName, @body, @createdAt, @readByJson)`).run(row);
      db.prepare(`UPDATE staffChatThreads SET updatedAt = @updatedAt
        WHERE id = @threadId AND tenantId = @tenantId AND branchId = @branchId`)
        .run({ updatedAt: row.createdAt, threadId: team.id, tenantId: access.tenantId, branchId });
      const message = { id: row.id, conversationId: team.id, type: "team", senderUserId: user.id, senderName: row.senderName, body, createdAt: row.createdAt };
      auditMessage({ ...row, conversationId: team.id }, access, "team");
      realtimeService.broadcast("staff-self.chat_message", { message }, { tenantId: access.tenantId, branchId });
      return message;
    }

    const conversation = privateConversation(conversationId, access, branchId);
    if (!conversation) throw notFound("Conversation not found");
    const row = {
      id: makeId("private_msg"), tenantId: access.tenantId, branchId, conversationId,
      senderUserId: user.id, senderName: user.name || "Staff", body, createdAt: now()
    };
    db.prepare(`INSERT INTO staffPrivateChatMessages
      (id, tenantId, branchId, conversationId, senderUserId, senderName, body, createdAt)
      VALUES (@id, @tenantId, @branchId, @conversationId, @senderUserId, @senderName, @body, @createdAt)`).run(row);
    db.prepare(`UPDATE staffPrivateConversations SET updatedAt = @updatedAt
      WHERE id = @conversationId AND tenantId = @tenantId AND branchId = @branchId`)
      .run({ updatedAt: row.createdAt, conversationId, tenantId: access.tenantId, branchId });
    const message = { id: row.id, conversationId, type: "private-owner", senderUserId: user.id, senderName: row.senderName, body, createdAt: row.createdAt };
    auditMessage(row, access, "private-owner");
    realtimeService.sendToUsers("team-chat.private-message", { message }, {
      tenantId: access.tenantId,
      userIds: participantIds(conversationId, access.tenantId, branchId)
    });
    return message;
  }
};
