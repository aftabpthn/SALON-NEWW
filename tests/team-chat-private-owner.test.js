import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { db } from "../server/db.js";
import { authService } from "../server/services/auth.service.js";
import { realtimeService } from "../server/services/realtime.service.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function tokenFor(user, tenantId, branchId) {
  return authService.signJwt({
    iss: "aura-salon-api",
    aud: "aura-mobile",
    typ: "access",
    sub: user.id,
    tenantId,
    email: user.email,
    role: user.role,
    staffId: user.staffId || "",
    branchId,
    branchIds: [branchId],
    permissions: [],
    permissionVersion: 1,
    jti: `test_${user.id}`
  }, 300);
}

async function api(baseUrl, path, token, branchId, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-branch-id": branchId,
      ...(method === "POST" ? { "idempotency-key": `chat-${Date.now()}-${Math.random()}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const envelope = text ? JSON.parse(text) : null;
  return { status: response.status, payload: envelope?.success ? envelope.data : envelope };
}

test("private owner chat enforces participant, tenant, branch and JWT identity ACLs", async () => {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const tenantId = `tenant_chat_${stamp}`;
  const otherTenantId = `tenant_chat_other_${stamp}`;
  const branchId = `branch_chat_${stamp}`;
  const otherBranchId = `branch_chat_other_${stamp}`;
  const createdAt = new Date().toISOString();
  const users = {
    owner: { id: `owner_${stamp}`, email: `owner_${stamp}@test.local`, role: "owner", staffId: "" },
    staffA: { id: `staff_a_${stamp}`, email: `staff_a_${stamp}@test.local`, role: "staff", staffId: `staff_record_a_${stamp}` },
    staffB: { id: `staff_b_${stamp}`, email: `staff_b_${stamp}@test.local`, role: "staff", staffId: `staff_record_b_${stamp}` },
    outsider: { id: `outsider_${stamp}`, email: `outsider_${stamp}@test.local`, role: "staff", staffId: `staff_record_out_${stamp}` }
  };

  const insertTenant = db.prepare(`INSERT INTO tenants
    (id, name, slug, status, subscriptionStatus, createdAt, updatedAt)
    VALUES (@id, @name, @slug, 'active', 'active', @createdAt, @createdAt)`);
  insertTenant.run({ id: tenantId, name: "Chat tenant", slug: `chat-${stamp}`, createdAt });
  insertTenant.run({ id: otherTenantId, name: "Other chat tenant", slug: `chat-other-${stamp}`, createdAt });
  const insertUser = db.prepare(`INSERT INTO tenant_users
    (id, tenantId, name, email, role, branchIds, staffId, status, permissionVersion, createdAt, updatedAt)
    VALUES (@id, @tenantId, @name, @email, @role, @branchIds, @staffId, 'active', 1, @createdAt, @createdAt)`);
  for (const [key, user] of Object.entries(users)) {
    insertUser.run({
      ...user,
      tenantId: key === "outsider" ? otherTenantId : tenantId,
      name: key,
      branchIds: JSON.stringify([branchId, otherBranchId]),
      createdAt
    });
  }

  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/team-chat`;
  const tokens = {
    owner: tokenFor(users.owner, tenantId, branchId),
    staffA: tokenFor(users.staffA, tenantId, branchId),
    staffB: tokenFor(users.staffB, tenantId, branchId),
    outsider: tokenFor(users.outsider, otherTenantId, branchId)
  };
  const socketFrames = new Map(Object.values(users).map((user) => [user.id, []]));
  for (const [key, user] of Object.entries(users)) {
    realtimeService.clients.set(`test_socket_${user.id}`, {
      access: { tenantId: key === "outsider" ? otherTenantId : tenantId, userId: user.id },
      ws: { readyState: 1, send: (frame) => socketFrames.get(user.id).push(JSON.parse(frame)) }
    });
  }

  try {
    const created = await api(baseUrl, "/private-owner", tokens.staffA, branchId, { method: "POST", body: {
      userId: users.staffB.id,
      tenantId: otherTenantId,
      branchId: otherBranchId,
      participantUserId: users.staffB.id
    } });
    assert.equal(created.status, 200);
    assert.equal(created.payload.type, "private-owner");
    assert.deepEqual(new Set(created.payload.participantUserIds), new Set([users.staffA.id, users.owner.id]));
    const conversationId = created.payload.id;

    const again = await api(baseUrl, "/private-owner", tokens.staffA, branchId, { method: "POST", body: {} });
    assert.equal(again.status, 200);
    assert.equal(again.payload.id, conversationId);

    const ownerSelf = await api(baseUrl, "/private-owner", tokens.owner, branchId, { method: "POST", body: {} });
    assert.equal(ownerSelf.status, 400);

    const eventCountBefore = db.prepare("SELECT COUNT(*) AS count FROM realtime_events WHERE tenantId = @tenantId").get({ tenantId }).count;
    const staffMessage = await api(baseUrl, `/conversations/${conversationId}/messages`, tokens.staffA, branchId, {
      method: "POST",
      body: { body: "Private hello", userId: users.staffB.id, senderUserId: users.staffB.id, tenantId: otherTenantId, branchId: otherBranchId }
    });
    assert.equal(staffMessage.status, 201);
    assert.equal(staffMessage.payload.senderUserId, users.staffA.id);
    assert.equal(staffMessage.payload.body, "Private hello");
    assert.equal(socketFrames.get(users.staffA.id).length, 1);
    assert.equal(socketFrames.get(users.owner.id).length, 1);
    assert.equal(socketFrames.get(users.staffB.id).length, 0);
    assert.equal(socketFrames.get(users.outsider.id).length, 0);
    const eventCountAfter = db.prepare("SELECT COUNT(*) AS count FROM realtime_events WHERE tenantId = @tenantId").get({ tenantId }).count;
    assert.equal(eventCountAfter, eventCountBefore);

    const ownerReply = await api(baseUrl, `/conversations/${conversationId}/messages`, tokens.owner, branchId, {
      method: "POST",
      body: { body: "Owner reply" }
    });
    assert.equal(ownerReply.status, 201);
    assert.equal(ownerReply.payload.senderUserId, users.owner.id);

    for (const [token, expectedIds] of [
      [tokens.staffA, [conversationId]],
      [tokens.owner, [conversationId]],
      [tokens.staffB, []]
    ]) {
      const listed = await api(baseUrl, "/conversations", token, branchId);
      assert.equal(listed.status, 200);
      assert.ok(listed.payload.some((item) => item.type === "team"));
      assert.deepEqual(listed.payload.filter((item) => item.type === "private-owner").map((item) => item.id), expectedIds);
    }
    const staffList = await api(baseUrl, "/conversations", tokens.staffA, branchId);
    const ownerList = await api(baseUrl, "/conversations", tokens.owner, branchId);
    assert.equal(staffList.payload.find((item) => item.type === "private-owner").title, "Owner chat");
    assert.equal(ownerList.payload.find((item) => item.type === "private-owner").title, "staffA · Private");

    for (const token of [tokens.staffA, tokens.owner]) {
      const messages = await api(baseUrl, `/conversations/${conversationId}/messages`, token, branchId);
      assert.equal(messages.status, 200);
      assert.deepEqual(messages.payload.map((message) => message.senderUserId), [users.staffA.id, users.owner.id]);
    }

    const staffBRead = await api(baseUrl, `/conversations/${conversationId}/messages`, tokens.staffB, branchId);
    assert.equal(staffBRead.status, 404);
    const staffBSend = await api(baseUrl, `/conversations/${conversationId}/messages`, tokens.staffB, branchId, { method: "POST", body: { body: "intrusion" } });
    assert.equal(staffBSend.status, 404);
    const outsiderRead = await api(baseUrl, `/conversations/${conversationId}/messages`, tokens.outsider, branchId);
    assert.equal(outsiderRead.status, 404);
    const otherBranchRead = await api(baseUrl, `/conversations/${conversationId}/messages`, tokens.owner, otherBranchId);
    assert.equal(otherBranchRead.status, 404);

    const stored = db.prepare(`SELECT tenantId, branchId, senderUserId FROM staffPrivateChatMessages
      WHERE id = @id`).get({ id: staffMessage.payload.id });
    assert.deepEqual(stored, { tenantId, branchId, senderUserId: users.staffA.id });
  } finally {
    await close(server);
    for (const user of Object.values(users)) realtimeService.clients.delete(`test_socket_${user.id}`);
    db.prepare("DELETE FROM idempotency_keys WHERE tenantId IN (@tenantId, @otherTenantId)").run({ tenantId, otherTenantId });
    db.prepare("DELETE FROM audit_logs WHERE tenantId IN (@tenantId, @otherTenantId)").run({ tenantId, otherTenantId });
    db.prepare("DELETE FROM staffPrivateChatMessages WHERE tenantId IN (@tenantId, @otherTenantId)").run({ tenantId, otherTenantId });
    db.prepare("DELETE FROM staffPrivateConversationParticipants WHERE tenantId IN (@tenantId, @otherTenantId)").run({ tenantId, otherTenantId });
    db.prepare("DELETE FROM staffPrivateConversations WHERE tenantId IN (@tenantId, @otherTenantId)").run({ tenantId, otherTenantId });
    db.prepare("DELETE FROM staffChatMessages WHERE tenantId IN (@tenantId, @otherTenantId)").run({ tenantId, otherTenantId });
    db.prepare("DELETE FROM staffChatThreads WHERE tenantId IN (@tenantId, @otherTenantId)").run({ tenantId, otherTenantId });
    db.prepare("DELETE FROM tenant_users WHERE tenantId IN (@tenantId, @otherTenantId)").run({ tenantId, otherTenantId });
  }
});
