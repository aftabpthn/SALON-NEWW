import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { db } from "../server/db.js";
import { realtimeService } from "../server/services/realtime.service.js";
import { staffSelfResponsePresenterService } from "../server/services/staff-self-response-presenter.service.js";

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
    socket.on("message", function onMessage(raw) {
      const frame = JSON.parse(raw.toString());
      if (frame.type !== type) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(frame);
    });
  });
}

function rejectedUpgrade(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    socket.once("open", () => reject(new Error("WebSocket upgrade unexpectedly succeeded")));
    socket.once("error", () => {});
  });
}

test("WebSocket tickets are branch-scoped and single-use", async () => {
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
    assert.equal(loginResponse.status, 201);
    assert.match(loginResponse.headers.get("set-cookie") || "", /HttpOnly/i);
    const loginEnvelope = await loginResponse.json();
    const login = loginEnvelope.data || loginEnvelope;
    const branchId = login.user.branchId || login.user.branchIds?.[0] || db.prepare("SELECT id FROM branches LIMIT 1").get()?.id;
    const headers = {
      authorization: `Bearer ${login.accessToken}`,
      "content-type": "application/json",
      "x-branch-id": branchId
    };
    const ticketResponse = await fetch(`${origin}/api/v1/realtime/ticket`, {
      method: "POST",
      headers,
      body: JSON.stringify({ branchId })
    });
    assert.equal(ticketResponse.status, 201);
    const ticketEnvelope = await ticketResponse.json();
    const issued = ticketEnvelope.data || ticketEnvelope;
    assert.deepEqual(issued.channels, [`branch:${branchId}`]);

    const socketUrl = `ws://127.0.0.1:${server.address().port}/api/v1/realtime?ticket=${encodeURIComponent(issued.ticket)}`;
    socket = new WebSocket(socketUrl);
    const ready = await waitForFrame(socket, "connection.ready");
    assert.deepEqual(ready.payload.channels, [`branch:${branchId}`]);
    assert.equal(await rejectedUpgrade(socketUrl), 401);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) await new Promise((resolve) => { socket.once("close", resolve); socket.close(); });
    await close(server);
  }
});

test("staff WebAuthn and staff-self mutation policies are explicit", async () => {
  const webauthn = await readFile(new URL("../server/services/webauthn.service.js", import.meta.url), "utf8");
  const routes = await readFile(new URL("../server/routes/staff-self.routes.js", import.meta.url), "utf8");
  assert.match(webauthn, /user\.staffId && !parsed\.userVerified/);
  assert.doesNotMatch(routes, /staff-self\/appointments\/:id/);
  assert.match(routes, /requireIdempotencyKey/);
});

test("staff-self presenter excludes restricted finance and all client fields", () => {
  const access = { tenantId: "tenant_aura", role: "staff", permissions: ["read:appointments"] };
  const dashboard = staffSelfResponsePresenterService.dashboard({
    summary: { appointments: 4, revenue: 50000, appointmentValue: 70000, uniqueClients: 3 },
    appointments: [{ id: "appointment_1", clientId: "client_1", clientName: "Private", notes: "private" }],
    sales: [{ id: "sale_1", total: 50000, commissionTotal: 5000 }]
  }, access);
  assert.deepEqual(dashboard, { summary: { appointments: 4 }, appointments: [{ id: "appointment_1" }] });

  const enterprise = staffSelfResponsePresenterService.enterprise({
    home: { tasks: 2, expectedRevenue: 80000, pendingPayments: 1 },
    aiCoach: [{ title: "Revenue coach", body: "Need 80000 more" }],
    leaderboard: [{ staffId: "staff_1", score: 90, revenue: 90000 }]
  }, access);
  assert.deepEqual(enterprise, { home: { tasks: 2 }, leaderboard: [{ staffId: "staff_1", score: 90 }] });

  const daily = staffSelfResponsePresenterService.staffData({ appointments: [{ id: "appointment_1", customerName: "Private", notes: "private" }] }, access);
  assert.deepEqual(daily, { appointments: [{ id: "appointment_1" }] });
});

test("staff-self presenter preserves finance access and only allows invoice client name", () => {
  const financialAccess = { tenantId: "tenant_aura", role: "custom", permissions: ["read:sales"] };
  const financial = { summary: { revenue: 50000 }, sales: [{ total: 50000, clientName: "Private" }] };
  assert.deepEqual(staffSelfResponsePresenterService.dashboard(financial, financialAccess), { summary: { revenue: 50000 }, sales: [{ total: 50000 }] });
  assert.deepEqual(staffSelfResponsePresenterService.invoiceDetail({ id: "invoice_1", clientName: "Allowed", clientId: "client_1", notes: "private" }), { id: "invoice_1", clientName: "Allowed" });
});
