import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.js";
import { db } from "../server/db.js";
import { authService } from "../server/services/auth.service.js";
import { ensureStaffClientMediaSchema } from "../server/services/staff-client-media-schema.service.js";
import { staffClientMediaUploadService } from "../server/services/staff-client-media-upload.service.js";

const jpeg = (value = 0x41) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, value, 0xff, 0xd9]);

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function upload(origin, clientId, token, branchId, { bytes = jpeg(), mime = "image/jpeg", name = "photo.jpg", fields = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("file", new Blob([bytes], { type: mime }), name);
  return fetch(`${origin}/api/v1/staff-self/clients/${encodeURIComponent(clientId)}/media`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { "x-branch-id": branchId } : {})
    },
    body: form
  });
}

async function fileCount(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    count += entry.isDirectory() ? await fileCount(join(directory, entry.name)) : 1;
  }
  return count;
}

test("authenticated staff client media multipart upload is scoped and private", async (t) => {
  const mediaDir = await mkdtemp(join(tmpdir(), "aura-client-media-"));
  const previousMediaDir = process.env.AURA_MEDIA_DIR;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AURA_MEDIA_DIR = mediaDir;
  process.env.NODE_ENV = "test";
  const server = await listen(createApp());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ids = [];
  const mediaIds = [];
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
    const loginJson = await loginResponse.json();
    const login = loginJson.data || loginJson;
    const token = login.accessToken;
    const branchId = login.user.branchId || login.user.branchIds[0];
    const client = db.prepare("SELECT id FROM clients WHERE tenantId = @tenantId AND branchId = @branchId LIMIT 1").get({ tenantId: "tenant_aura", branchId });
    assert.ok(client?.id, "seeded scoped client is required");

    await t.test("rejects unauthenticated and unauthorized requests before upload", async () => {
      assert.equal((await upload(origin, client.id, "", branchId)).status, 401);
      assert.equal((await fetch(`${origin}/uploads/staff-client-media/legacy.jpg`)).status, 404);
      const now = new Date().toISOString();
      const userId = `test_media_denied_${Date.now()}`;
      ids.push(userId);
      db.prepare(`INSERT INTO tenant_users
        (id, tenantId, name, email, role, branchIds, status, createdAt, updatedAt, permissionVersion)
        VALUES (@id, @tenantId, @name, @email, @role, @branchIds, 'active', @createdAt, @updatedAt, 1)`).run({
        id: userId, tenantId: "tenant_aura", name: "Denied media user", email: `${userId}@example.test`,
        role: `mediaDenied${Date.now()}`, branchIds: JSON.stringify([branchId]), createdAt: now, updatedAt: now
      });
      const tenant = db.prepare("SELECT * FROM tenants WHERE id = @id").get({ id: "tenant_aura" });
      const denied = authService.issueTokenPair({ tenant, user: { id: userId, name: "Denied", email: `${userId}@example.test`, role: `mediaDenied${Date.now()}`, branchIds: [branchId], permissionVersion: 1 }, branchId });
      assert.equal((await upload(origin, client.id, denied.accessToken, branchId)).status, 403);
    });

    await t.test("rejects cross-tenant, oversized, invalid MIME, spoofing, invalid bytes, and traversal", async () => {
      assert.equal((await upload(origin, "client_from_another_tenant", token, branchId)).status, 404);
      await assert.rejects(() => staffClientMediaUploadService.create(client.id, {}, {
        buffer: jpeg(), size: jpeg().length, mimetype: "image/jpeg", originalname: "cross-tenant.jpg"
      }, { tenantId: "tenant_other", branchId, role: "owner", permissions: ["*"] }), (error) => error.status === 404);
      assert.equal((await upload(origin, client.id, token, branchId, { bytes: Buffer.alloc(5 * 1024 * 1024 + 1), name: "large.jpg" })).status, 413);
      assert.equal((await upload(origin, client.id, token, branchId, { mime: "text/html", name: "attack.html", bytes: Buffer.from("<html>") })).status, 400);
      assert.equal((await upload(origin, client.id, token, branchId, { mime: "image/png", name: "mismatch.png" })).status, 400);
      assert.equal((await upload(origin, client.id, token, branchId, { name: "spoof.png" })).status, 400);
      assert.equal((await upload(origin, client.id, token, branchId, { mime: "image/png", name: "invalid.png", bytes: Buffer.from("not an image") })).status, 400);
      assert.equal((await upload(origin, client.id, token, branchId, { name: "../escape.jpg" })).status, 400);
      assert.equal((await upload(origin, client.id, token, branchId, { fields: { dataUrl: "data:image/jpeg;base64,/9j/" } })).status, 400);
    });

    await t.test("stores random private names, serves authenticated content, and prevents stable duplicates", async () => {
      const firstResponse = await upload(origin, client.id, token, branchId, { name: "same-name.jpg", fields: { title: "Before photo", type: "photo" } });
      assert.equal(firstResponse.status, 201);
      const firstJson = await firstResponse.json();
      const first = firstJson.data || firstJson;
      mediaIds.push(first.id);
      assert.equal(first.clientId, client.id);
      assert.equal(first.mimeType, "image/jpeg");
      assert.ok(!("storageName" in first));
      assert.ok(!("path" in first));
      const audit = db.prepare(`SELECT * FROM staffSelfAudit
        WHERE tenantId = @tenantId AND branchId = @branchId AND action = 'staff.client_media_added' AND targetId = @targetId`).get({
        tenantId: "tenant_aura", branchId, targetId: first.id
      });
      assert.equal(audit?.targetType, "staffClientMedia");
      assert.equal(JSON.parse(audit.detailsJson).clientId, client.id);
      const contentResponse = await fetch(`${origin}${first.url}`, { headers: { authorization: `Bearer ${token}`, "x-branch-id": branchId } });
      assert.equal(contentResponse.status, 200);
      assert.deepEqual(Buffer.from(await contentResponse.arrayBuffer()), jpeg());
      assert.equal(contentResponse.headers.get("x-content-type-options"), "nosniff");

      const secondResponse = await upload(origin, client.id, token, branchId, { bytes: jpeg(0x42), name: "same-name.jpg", fields: { title: "After photo", type: "photo" } });
      assert.equal(secondResponse.status, 201);
      const secondJson = await secondResponse.json();
      const second = secondJson.data || secondJson;
      mediaIds.push(second.id);
      assert.notEqual(second.id, first.id);

      const duplicateResponse = await upload(origin, client.id, token, branchId, { name: "renamed.jpg", fields: { title: "Before photo", type: "photo" } });
      assert.equal(duplicateResponse.status, 201);
      const duplicateJson = await duplicateResponse.json();
      assert.equal((duplicateJson.data || duplicateJson).id, first.id);
    });

    await t.test("removes the private file when the database transaction fails", async () => {
      ensureStaffClientMediaSchema();
      const before = await fileCount(mediaDir);
      db.exec(`CREATE TRIGGER test_staff_media_db_failure BEFORE INSERT ON staffClientMediaFiles
        WHEN NEW.title = 'Force DB failure' BEGIN SELECT RAISE(ABORT, 'forced media DB failure'); END`);
      try {
        await assert.rejects(() => staffClientMediaUploadService.create(client.id, { title: "Force DB failure", type: "photo" }, {
          buffer: jpeg(0x43), size: jpeg(0x43).length, mimetype: "image/jpeg", originalname: "cleanup.jpg"
        }, { tenantId: "tenant_aura", branchId, role: "owner", permissions: ["*"] }), /forced media DB failure/);
      } finally {
        db.exec("DROP TRIGGER IF EXISTS test_staff_media_db_failure");
      }
      assert.equal(await fileCount(mediaDir), before);
    });
  } finally {
    ensureStaffClientMediaSchema();
    for (const mediaId of mediaIds) {
      db.prepare("DELETE FROM staffSelfAudit WHERE targetType = 'staffClientMedia' AND targetId = @mediaId").run({ mediaId });
      db.prepare("DELETE FROM staffClientMediaFiles WHERE mediaId = @mediaId").run({ mediaId });
      db.prepare("DELETE FROM staffClientMedia WHERE id = @mediaId").run({ mediaId });
    }
    for (const id of ids) {
      db.prepare("DELETE FROM auth_refresh_tokens WHERE userId = @id").run({ id });
      db.prepare("DELETE FROM tenant_users WHERE id = @id").run({ id });
    }
    await close(server);
    await rm(mediaDir, { recursive: true, force: true });
    if (previousMediaDir === undefined) delete process.env.AURA_MEDIA_DIR; else process.env.AURA_MEDIA_DIR = previousMediaDir;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
  }
});
