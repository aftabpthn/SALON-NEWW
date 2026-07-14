import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { db } from "../server/db.js";
import { realtimeService } from "../server/services/realtime.service.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function waitForFrame(socket, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 5000);
    const onMessage = (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.type !== type) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(frame);
    };
    socket.on("message", onMessage);
  });
}

test("general settings persist by branch, project to staff, and publish realtime updates", async () => {
  const savepoint = `general_settings_${randomUUID().replaceAll("-", "")}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  const server = await listen(createApp());
  realtimeService.attach(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  let socket;
  try {
    const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant_aura",
        email: "owner@aurasalon.example",
        password: process.env.DEMO_ADMIN_PASSWORD || "AuraOwner#2026"
      })
    });
    assert.ok([200, 201].includes(loginResponse.status));
    const login = await loginResponse.json();
    const token = login.data.accessToken;
    const branchId = login.data.user.branchId || login.data.user.branchIds?.[0] || db.prepare("SELECT id FROM branches LIMIT 1").get()?.id || "";
    assert.ok(branchId, "test owner needs an accessible branch");
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-tenant-id": "tenant_aura",
      "x-branch-id": branchId
    };

    const currentResponse = await fetch(`${origin}/api/v1/settings/general?branchId=${encodeURIComponent(branchId)}`, { headers });
    assert.equal(currentResponse.status, 200);
    const currentEnvelope = await currentResponse.json();
    const current = currentEnvelope.data || currentEnvelope;

    const ticketResponse = await fetch(`${origin}/api/v1/realtime/ticket`, {
      method: "POST",
      headers,
      body: JSON.stringify({ branchId })
    });
    assert.equal(ticketResponse.status, 201);
    const ticketEnvelope = await ticketResponse.json();
    const ticket = (ticketEnvelope.data || ticketEnvelope).ticket;
    assert.ok(ticket);
    socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/v1/realtime?ticket=${encodeURIComponent(ticket)}`);
    await waitForFrame(socket, "connection.ready");
    const updateFrame = waitForFrame(socket, "settings.general.updated");
    const workspaceName = `Settings API ${randomUUID().slice(0, 8)}`;
    const saveResponse = await fetch(`${origin}/api/v1/settings/general`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        branchId,
        settings: {
          ...current.settings,
          workspace: { ...current.settings.workspace, workspaceName },
          dateTime: { ...current.settings.dateTime, businessDayStartHour: 99 }
        }
      })
    });
    assert.equal(saveResponse.status, 200);
    const savedEnvelope = await saveResponse.json();
    const saved = savedEnvelope.data || savedEnvelope;
    assert.equal(saved.settings.workspace.workspaceName, workspaceName);
    assert.equal(saved.settings.dateTime.businessDayStartHour, 23);

    const event = await updateFrame;
    assert.equal(event.payload.branchId, branchId);
    assert.equal(event.meta.channel, `branch:${branchId}`);

    const projectionResponse = await fetch(`${origin}/api/v1/staff-self/workspace-preferences`, { headers });
    assert.equal(projectionResponse.status, 200);
    const projectionEnvelope = await projectionResponse.json();
    const projection = projectionEnvelope.data || projectionEnvelope;
    assert.equal(projection.workspace.workspaceName, workspaceName);
    assert.equal(projection.defaults.ownerNotifications, undefined);
    assert.equal(projection.audit, undefined);
  } finally {
    if (socket) await new Promise((resolve) => { socket.once("close", resolve); socket.close(); });
    await close(server);
    db.exec(`ROLLBACK TO ${savepoint}`);
    db.exec(`RELEASE ${savepoint}`);
  }
});
