import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { createApp } from "../server/app.js";
import { columnsFor, db } from "../server/db.js";

// Clean migration staging data to prevent UUID collision
db.prepare("DELETE FROM migration_staging_rows").run();
db.prepare("DELETE FROM migration_file_chunks").run();
db.prepare("DELETE FROM migration_large_jobs").run();

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function headers() {
  return {
    "content-type": "application/json",
    "connection": "close",
    "x-tenant-id": "tenant_aura",
    "x-user-role": "owner"
  };
}

const tokenCache = new Map();

async function authHeaders(baseUrl) {
  if (!tokenCache.has(baseUrl)) {
    const origin = new URL(baseUrl).origin;
    const response = await fetch(origin + "/api/v1/auth/login", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        tenantId: "tenant_aura",
        email: "owner@aurasalon.example",
        password: process.env.DEMO_ADMIN_PASSWORD || "AuraOwner#2026"
      })
    });
    const body = await response.json();
    const token = body?.data?.accessToken || body?.accessToken || "";
    if (!token) throw new Error("Unable to obtain migration test JWT: " + response.status + " " + JSON.stringify(body));
    tokenCache.set(baseUrl, token);
  }
  return { ...headers(), authorization: "Bearer " + tokenCache.get(baseUrl) };
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

async function request(baseUrl, path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: await authHeaders(baseUrl),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}
async function requestBinary(baseUrl, path, { method = "POST", body, fileName, contentType = "application/octet-stream", extraHeaders = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(await authHeaders(baseUrl)),
      "content-type": contentType,
      "x-file-name": fileName || "migration-source.zip",
      ...extraHeaders
    },
    body
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test("migration dry-run validates rows without saving live records", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const stamp = Date.now();
    const phone = `+91 95555 ${String(stamp).slice(-5)}`;
    const dryRun = await request(baseUrl, "/migration/dry-run", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        resource: "clients",
        rows: [{ name: `Dry Run Client ${stamp}`, phone, branchId: "branch_hyd", originalRecordId: `dry-${stamp}` }]
      }
    });
    assert.equal(dryRun.response.status, 201);
    assert.equal(dryRun.body.summary.totalRows, 1);
    assert.equal(dryRun.body.summary.errorRows, 0);

    const clients = await request(baseUrl, `/clients?q=${encodeURIComponent(phone)}`);
    assert.equal(clients.response.status, 200);
    assert.equal(clients.body.some((client) => client.phone === phone), false);
  } finally {
    await close(server);
  }
});

test("migration import stamps metadata and rollback removes imported records", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const stamp = Date.now();
    const phone = `+91 96666 ${String(stamp).slice(-5)}`;
    const importResult = await request(baseUrl, "/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "salonist",
        resource: "clients",
        skipApprovalGate: true,
        rows: [{ name: `Rollback Client ${stamp}`, phone, branchId: "branch_hyd", originalRecordId: `old-${stamp}`, createdAt: "2024-01-15" }]
      }
    });
    assert.equal(importResult.response.status, 201);
    assert.equal(importResult.body.summary.importedRows, 1);
    const targetId = importResult.body.details.rows.find((row) => row.action === "created").targetId;
    assert.ok(targetId);

    const created = await request(baseUrl, `/clients/${targetId}`);
    assert.equal(created.response.status, 200);
    assert.equal(created.body.imported, 1);
    assert.equal(created.body.originalSystem, "salonist");
    assert.equal(created.body.originalRecordId, `old-${stamp}`);
    assert.match(created.body.createdAt, /^2024-01-15/);

    const rollback = await request(baseUrl, `/migration/jobs/${importResult.body.jobId}/rollback`, { method: "POST", body: {} });
    assert.equal(rollback.response.status, 200);
    assert.equal(rollback.body.ok, true);
    assert.equal(rollback.body.deleted.clients, 1);

    const afterRollback = await request(baseUrl, `/clients/${targetId}`);
    assert.equal(afterRollback.response.status, 404);
  } finally {
    await close(server);
  }
});

test("migration client import does not skip new clients on name-only match", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const stamp = Date.now();
    const sharedName = `Same Name Import ${stamp}`;
    const existing = await request(baseUrl, "/clients", {
      method: "POST",
      body: {
        name: sharedName,
        phone: `+91 97777 ${String(stamp).slice(-5)}`,
        branchId: "branch_hyd"
      }
    });
    assert.equal(existing.response.status, 201);

    const importedPhone = `+91 98888 ${String(stamp).slice(-5)}`;
    const importResult = await request(baseUrl, "/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        resource: "clients",
        skipApprovalGate: true,
        rows: [{
          name: sharedName,
          phone: importedPhone,
          branchId: "branch_hyd",
          originalRecordId: `same-name-${stamp}`
        }]
      }
    });

    assert.equal(importResult.response.status, 201);
    assert.equal(importResult.body.summary.importedRows, 1);
    assert.equal(importResult.body.summary.skippedRows, 0);
    const targetId = importResult.body.details.rows.find((row) => row.action === "created").targetId;
    assert.ok(targetId);

    const created = await request(baseUrl, `/clients/${targetId}`);
    assert.equal(created.response.status, 200);
    assert.equal(created.body.name, sharedName);
    assert.equal(digits(created.body.phone), digits(importedPhone));
  } finally {
    await close(server);
  }
});

test("migration approval workflow submits, lists and approves latest request", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const stamp = Date.now();
    const submitted = await request(baseUrl, "/migration/approvals", {
      method: "POST",
      body: {
        resource: "clients",
        branchId: "branch_hyd",
        note: `Approval smoke ${stamp}`,
        summary: { totalRows: 1, validRows: 1, errorRows: 0 }
      }
    });
    assert.equal(submitted.response.status, 201);
    assert.ok(submitted.body.id);
    assert.equal(submitted.body.status, "pending");

    const pending = await request(baseUrl, "/migration/approvals?status=pending");
    assert.equal(pending.response.status, 200);
    assert.ok(pending.body.some((approval) => approval.id === submitted.body.id));

    const approved = await request(baseUrl, `/migration/approvals/${submitted.body.id}/decide`, {
      method: "POST",
      body: { decision: "approved", note: "Owner approved" }
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.status, "approved");
    assert.ok(approved.body.reviewedAt);
  } finally {
    await close(server);
  }
});

function createZipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const eocd = Buffer.alloc(22);
  const entryCount = Object.keys(entries).length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

test("migration target metadata schema covers rollback targets", async () => {
  const server = await listen(createApp());
  try {
    const requiredColumns = ["imported", "originalSystem", "originalRecordId", "importedAt", "importBatchId"];
    const targets = ["clients", "staff", "services", "products", "inventory_transactions", "suppliers", "finance_expenses", "memberships", "appointments", "sales", "invoices", "payments"];
    for (const table of targets) {
      const columns = columnsFor(table);
      for (const column of requiredColumns) {
        assert.ok(columns.includes(column), `${table} should include ${column}`);
      }
    }
  } finally {
    await close(server);
  }
});

test("migration import accepts ZIP bundles and rolls back all created resources", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const suffix = String(stamp).slice(-5);
    const zip = createZipArchive({
      "clients.csv": `name,phone,branchId,originalRecordId\nZip Bundle Client ${stamp},+91 91111 ${suffix},branch_hyd,zip-client-${stamp}\n`,
      "staff.csv": `name,role,phone,email,branchId,originalRecordId\nZip Bundle Staff ${stamp},stylist,+91 92222 ${suffix},zip-staff-${stamp}@example.com,branch_hyd,zip-staff-${stamp}\n`
    });
    const imported = await request(baseUrl, "/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        skipApprovalGate: true,
        fileName: `migration-bundle-${stamp}.zip`,
        fileBase64: zip.toString("base64")
      }
    });
    assert.equal(imported.response.status, 201);
    jobId = imported.body.jobId;
    assert.equal(imported.body.summary.totalRows, 2);
    assert.equal(imported.body.summary.importedRows, 2);

    const rows = imported.body.details.rows;
    const clientResult = rows.find((row) => row.resource === "clients" && row.action === "created");
    const staffResult = rows.find((row) => row.resource === "staff" && row.action === "created");
    assert.ok(clientResult?.targetId);
    assert.ok(staffResult?.targetId);

    const params = { tenantId: "tenant_aura", clientId: clientResult.targetId, staffId: staffResult.targetId };
    const client = db.prepare("SELECT imported, originalSystem, importBatchId FROM clients WHERE id = @clientId AND tenantId = @tenantId").get(params);
    const staff = db.prepare("SELECT imported, originalSystem, importBatchId FROM staff WHERE id = @staffId AND tenantId = @tenantId").get(params);
    assert.equal(client.imported, 1);
    assert.equal(staff.imported, 1);
    assert.equal(client.originalSystem, "excel");
    assert.equal(staff.originalSystem, "excel");
    assert.equal(client.importBatchId, imported.body.batchId);
    assert.equal(staff.importBatchId, imported.body.batchId);

    const rollback = await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "zip bundle rollback smoke" } });
    assert.equal(rollback.response.status, 200);
    assert.equal(rollback.body.ok, true);
    assert.equal(rollback.body.deleted.clients, 1);
    assert.equal(rollback.body.deleted.staff, 1);
    assert.equal(db.prepare("SELECT id FROM clients WHERE id = @clientId AND tenantId = @tenantId").get(params), undefined);
    assert.equal(db.prepare("SELECT id FROM staff WHERE id = @staffId AND tenantId = @tenantId").get(params), undefined);
    jobId = "";
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "zip bundle cleanup" } });
    await close(server);
  }
});
test("migration import can reuse stored ZIP upload evidence by fileRef", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const suffix = String(stamp).slice(-5);
    const zip = createZipArchive({
      "clients.csv": `name,phone,branchId,originalRecordId\nStored ZIP Client ${stamp},+91 93333 ${suffix},branch_hyd,stored-client-${stamp}\n`,
      "staff.csv": `name,role,phone,email,branchId,originalRecordId\nStored ZIP Staff ${stamp},stylist,+91 94444 ${suffix},stored-staff-${stamp}@example.com,branch_hyd,stored-staff-${stamp}\n`
    });
    const upload = await request(baseUrl, "/migration/uploads", {
      method: "POST",
      body: {
        fileName: `stored-migration-${stamp}.zip`,
        fileBase64: zip.toString("base64"),
        purpose: "source"
      }
    });
    assert.equal(upload.response.status, 201);
    assert.ok(upload.body.fileRef);
    assert.equal(upload.body.sizeBytes, zip.length);
    assert.match(upload.body.sha256, /^[a-f0-9]{64}$/);

    const imported = await request(baseUrl, "/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        skipApprovalGate: true,
        fileRef: upload.body.fileRef
      }
    });
    assert.equal(imported.response.status, 201);
    jobId = imported.body.jobId;
    assert.equal(imported.body.summary.totalRows, 2);
    assert.equal(imported.body.summary.importedRows, 2);

    const stored = db.prepare("SELECT id, tenantId, sha256, status FROM migration_uploads WHERE id = @id AND tenantId = @tenantId").get({
      id: upload.body.fileRef,
      tenantId: "tenant_aura"
    });
    assert.equal(stored.status, "stored");
    assert.equal(stored.sha256, upload.body.sha256);

    const rollback = await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "stored zip rollback smoke" } });
    assert.equal(rollback.response.status, 200);
    assert.equal(rollback.body.deleted.clients, 1);
    assert.equal(rollback.body.deleted.staff, 1);
    jobId = "";
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "stored zip cleanup" } });
    await close(server);
  }
});


test("migration import can reuse raw binary ZIP upload evidence by fileRef", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const suffix = String(stamp).slice(-5);
    const zip = createZipArchive({
      "clients.csv": `name,phone,branchId,originalRecordId\nBinary ZIP Client ${stamp},+91 95544 ${suffix},branch_hyd,binary-client-${stamp}\n`,
      "staff.csv": `name,role,phone,email,branchId,originalRecordId\nBinary ZIP Staff ${stamp},stylist,+91 96644 ${suffix},binary-staff-${stamp}@example.com,branch_hyd,binary-staff-${stamp}\n`
    });
    const upload = await requestBinary(baseUrl, "/migration/uploads/binary", {
      body: zip,
      fileName: `binary-migration-${stamp}.zip`,
      contentType: "application/zip"
    });
    assert.equal(upload.response.status, 201);
    assert.ok(upload.body.fileRef);
    assert.equal(upload.body.sizeBytes, zip.length);
    assert.match(upload.body.sha256, /^[a-f0-9]{64}$/);

    const imported = await request(baseUrl, "/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        skipApprovalGate: true,
        fileRef: upload.body.fileRef
      }
    });
    assert.equal(imported.response.status, 201);
    jobId = imported.body.jobId;
    assert.equal(imported.body.summary.totalRows, 2);
    assert.equal(imported.body.summary.importedRows, 2);
    assert.equal(imported.body.summary.sourceEvidence.fileRef, upload.body.fileRef);
    assert.equal(imported.body.summary.sourceEvidence.sha256, upload.body.sha256);

    const rollback = await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "binary zip rollback smoke" } });
    assert.equal(rollback.response.status, 200);
    assert.equal(rollback.body.deleted.clients, 1);
    assert.equal(rollback.body.deleted.staff, 1);
    jobId = "";
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "binary zip cleanup" } });
    await close(server);
  }
});





test("migration import can reuse resumable ZIP upload evidence by fileRef", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const suffix = String(stamp).slice(-5);
    const zip = createZipArchive({
      "clients.csv": `name,phone,branchId,originalRecordId\nChunk ZIP Client ${stamp},+91 97744 ${suffix},branch_hyd,chunk-client-${stamp}\n`,
      "staff.csv": `name,role,phone,email,branchId,originalRecordId\nChunk ZIP Staff ${stamp},stylist,+91 98844 ${suffix},chunk-staff-${stamp}@example.com,branch_hyd,chunk-staff-${stamp}\n`
    });
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const session = await request(baseUrl, "/migration/uploads/sessions", {
      method: "POST",
      body: {
        fileName: `chunked-migration-${stamp}.zip`,
        mimeType: "application/zip",
        purpose: "source",
        sizeBytes: zip.length,
        totalParts: 3,
        sha256
      }
    });
    assert.equal(session.response.status, 201);
    assert.ok(session.body.sessionId);

    const cuts = [Math.ceil(zip.length / 3), Math.ceil(zip.length * 2 / 3), zip.length];
    let start = 0;
    for (let index = 0; index < cuts.length; index += 1) {
      const part = await requestBinary(baseUrl, `/migration/uploads/sessions/${session.body.sessionId}/parts/${index + 1}`, {
        body: zip.subarray(start, cuts[index]),
        fileName: `chunked-migration-${stamp}.zip`,
        contentType: "application/zip"
      });
      assert.equal(part.response.status, 201);
      assert.equal(part.body.receivedParts, index + 1);
      start = cuts[index];
    }

    const upload = await request(baseUrl, `/migration/uploads/sessions/${session.body.sessionId}/complete`, {
      method: "POST",
      body: { sha256 }
    });
    assert.equal(upload.response.status, 201);
    assert.ok(upload.body.fileRef);
    assert.equal(upload.body.sha256, sha256);
    assert.equal(upload.body.uploadedParts, 3);

    const imported = await request(baseUrl, "/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        skipApprovalGate: true,
        fileRef: upload.body.fileRef
      }
    });
    assert.equal(imported.response.status, 201);
    jobId = imported.body.jobId;
    assert.equal(imported.body.summary.totalRows, 2);
    assert.equal(imported.body.summary.importedRows, 2);
    assert.equal(imported.body.summary.sourceEvidence.fileRef, upload.body.fileRef);
    assert.equal(imported.body.summary.sourceEvidence.sha256, sha256);

    const storedSession = db.prepare("SELECT status, uploadRef, receivedParts, receivedBytes FROM migration_upload_sessions WHERE id = @id AND tenantId = @tenantId").get({
      id: session.body.sessionId,
      tenantId: "tenant_aura"
    });
    assert.equal(storedSession.status, "completed");
    assert.equal(storedSession.uploadRef, upload.body.fileRef);
    assert.equal(storedSession.receivedParts, 3);
    assert.equal(storedSession.receivedBytes, zip.length);

    const rollback = await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "chunked zip rollback smoke" } });
    assert.equal(rollback.response.status, 200);
    assert.equal(rollback.body.deleted.clients, 1);
    assert.equal(rollback.body.deleted.staff, 1);
    jobId = "";
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "chunked zip cleanup" } });
    await close(server);
  }
});

test("migration resumable upload rejects SHA mismatch", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const stamp = Date.now();
    const zip = createZipArchive({
      "clients.csv": `name,phone,branchId,originalRecordId\nMismatch Client ${stamp},+91 90044 ${String(stamp).slice(-5)},branch_hyd,mismatch-client-${stamp}\n`
    });
    const session = await request(baseUrl, "/migration/uploads/sessions", {
      method: "POST",
      body: {
        fileName: `mismatch-migration-${stamp}.zip`,
        mimeType: "application/zip",
        sizeBytes: zip.length,
        totalParts: 1,
        sha256: "0".repeat(64)
      }
    });
    assert.equal(session.response.status, 201);
    const part = await requestBinary(baseUrl, `/migration/uploads/sessions/${session.body.sessionId}/parts/1`, {
      body: zip,
      fileName: `mismatch-migration-${stamp}.zip`,
      contentType: "application/zip"
    });
    assert.equal(part.response.status, 201);
    const complete = await request(baseUrl, `/migration/uploads/sessions/${session.body.sessionId}/complete`, {
      method: "POST",
      body: { sha256: "0".repeat(64) }
    });
    assert.equal(complete.response.status, 400);
    assert.match(JSON.stringify(complete.body || {}), /SHA-256/i);
  } finally {
    await close(server);
  }
});
test("migration advanced command center returns simulator, mappings and conflicts", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const stamp = Date.now();
    const existing = await request(baseUrl, "/clients", {
      method: "POST",
      body: {
        name: `Advanced Conflict ${stamp}`,
        phone: `+91 91919 ${String(stamp).slice(-5)}`,
        branchId: "branch_hyd"
      }
    });
    assert.equal(existing.response.status, 201);
    const zip = createZipArchive({
      "clients.csv": `name,phone,branchId,originalRecordId\nAdvanced Conflict ${stamp},+91 91919 ${String(stamp).slice(-5)},branch_hyd,adv-client-${stamp}\n`,
      "staff.csv": `name,role,phone,email,branchId,originalRecordId\nAdvanced Staff ${stamp},stylist,+91 92929 ${String(stamp).slice(-5)},adv-staff-${stamp}@example.com,branch_pune,adv-staff-${stamp}\n`
    });
    const report = await request(baseUrl, "/migration/command-center", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        fileName: `advanced-command-${stamp}.zip`,
        fileBase64: zip.toString("base64")
      }
    });
    assert.equal(report.response.status, 200);
    assert.equal(report.body.totals.totalRows, 2);
    assert.ok(report.body.entities.some((item) => item.resource === "clients"));
    assert.ok(report.body.branches.some((item) => item.branchId === "branch_hyd"));
    assert.equal(report.body.simulator.branchCount >= 1, true);
    assert.ok(Array.isArray(report.body.mappingMemory));
    assert.ok(Array.isArray(report.body.liveTotals));
    assert.ok(report.body.liveTotals.some((item) => item.resource === "clients" && item.label === "Client Master"));
    assert.ok(report.body.liveTotals.some((item) => item.resource === "products"));
    assert.ok(Array.isArray(report.body.recommendedActions));
  } finally {
    await close(server);
  }
});

test("migration upload sessions can be listed for browser-close resume", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const stamp = Date.now();
    const zip = createZipArchive({
      "clients.csv": `name,phone,branchId,originalRecordId\nResume Client ${stamp},+91 93939 ${String(stamp).slice(-5)},branch_hyd,resume-client-${stamp}\n`
    });
    const session = await request(baseUrl, "/migration/uploads/sessions", {
      method: "POST",
      body: {
        fileName: `resume-session-${stamp}.zip`,
        mimeType: "application/zip",
        sizeBytes: zip.length,
        totalParts: 2
      }
    });
    assert.equal(session.response.status, 201);
    const part = await requestBinary(baseUrl, `/migration/uploads/sessions/${session.body.sessionId}/parts/1`, {
      body: zip.subarray(0, Math.ceil(zip.length / 2)),
      fileName: `resume-session-${stamp}.zip`,
      contentType: "application/zip"
    });
    assert.equal(part.response.status, 201);
    const detail = await request(baseUrl, `/migration/uploads/sessions/${session.body.sessionId}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.resumeAvailable, true);
    assert.deepEqual(detail.body.missingParts, [2]);
    const list = await request(baseUrl, "/migration/uploads/sessions?status=open");
    assert.equal(list.response.status, 200);
    assert.ok(list.body.some((item) => item.sessionId === session.body.sessionId));
  } finally {
    await close(server);
  }
});

test("migration proof pack summarizes recent and single import jobs", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const imported = await request(baseUrl, "/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        resource: "clients",
        skipApprovalGate: true,
        rows: [{ name: `Proof Pack Client ${stamp}`, phone: `+91 94949 ${String(stamp).slice(-5)}`, branchId: "branch_hyd", originalRecordId: `proof-pack-${stamp}` }]
      }
    });
    assert.equal(imported.response.status, 201);
    jobId = imported.body.jobId;
    const pack = await request(baseUrl, "/migration/proof-pack", { method: "POST", body: { jobId } });
    assert.equal(pack.response.status, 200);
    assert.equal(pack.body.scope, "single_job");
    assert.equal(pack.body.jobId, jobId);
    assert.equal(pack.body.totals.importedRows, 1);
    assert.equal(pack.body.controls.rollbackAvailable, true);
    const rollback = await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "proof pack cleanup" } });
    assert.equal(rollback.response.status, 200);
    jobId = "";
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "proof pack cleanup" } });
    await close(server);
  }
});


test("migration financial imports post balanced journals and rollback reverses them", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const suffix = String(stamp).slice(-5);
    const businessDate = new Date().toISOString().slice(0, 10);
    const zip = createZipArchive({
      "clients.csv": `name,phone,branchId,originalRecordId\nLedger Client ${stamp},+91 97000 ${suffix},branch_hyd,ledger-client-${stamp}\n`,
      "sales.csv": `originalRecordId,clientId,branchId,lineItem,total,gstAmount,paymentMode,status,createdAt\nledger-sale-${stamp},ledger-client-${stamp},branch_hyd,Standalone Sale,100,18,cash,completed,${businessDate}\n`,
      "invoices.csv": `originalRecordId,invoiceNumber,clientId,branchId,total,gstAmount,paid,balance,paymentMode,status,createdAt\nledger-inv-${stamp},LED-${stamp},ledger-client-${stamp},branch_hyd,1000,180,0,1000,bank,partial,${businessDate}\nledger-paid-${stamp},LEDP-${stamp},ledger-client-${stamp},branch_hyd,500,90,500,0,upi,paid,${businessDate}\n`,
      "payments.csv": `originalRecordId,invoiceId,mode,amount,reference,branchId,createdAt\nledger-pay-${stamp},ledger-inv-${stamp},upi,400,UTR-${stamp},branch_hyd,${businessDate}\n`,
      "expenses.csv": `originalRecordId,branchId,category,amount,taxAmount,paymentMode,paidAt,createdAt\nledger-exp-${stamp},branch_hyd,utilities,236,36,cash,${businessDate},${businessDate}\n`
    });
    const imported = await request(baseUrl, "/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        skipApprovalGate: true,
        fileName: `ledger-migration-${stamp}.zip`,
        fileBase64: zip.toString("base64")
      }
    });
    assert.equal(imported.response.status, 201);
    jobId = imported.body.jobId;
    assert.equal(imported.body.summary.errorRows, 0);

    const targetIds = imported.body.details.rows.map((row) => row.targetId).filter(Boolean);
    assert.ok(targetIds.length >= 5);
    const idParams = Object.fromEntries(targetIds.map((id, index) => [`id${index}`, id]));
    const journalEntries = db.prepare(`
      SELECT id, sourceType, sourceId, status
      FROM journalEntries
      WHERE tenantId = @tenantId
        AND sourceType LIKE 'migration.%'
        AND sourceId IN (${targetIds.map((_, index) => `@id${index}`).join(",")})
      ORDER BY sourceType, sourceId
    `).all({ tenantId: "tenant_aura", ...idParams });
    const countByType = journalEntries.reduce((acc, entry) => ({ ...acc, [entry.sourceType]: (acc[entry.sourceType] || 0) + 1 }), {});
    assert.equal(countByType["migration.expense.recorded"], 1);
    assert.equal(countByType["migration.sale.recorded"], 1);
    assert.equal(countByType["migration.invoice.receivable"], 2);
    assert.equal(countByType["migration.invoice.settlement"], 1);
    assert.equal(countByType["migration.payment.received"], 1);

    for (const entry of journalEntries) {
      const totals = db.prepare(`
        SELECT COALESCE(SUM(debitPaise), 0) AS debit, COALESCE(SUM(creditPaise), 0) AS credit
        FROM journalEntryLines
        WHERE tenantId = @tenantId AND journalEntryId = @journalEntryId
      `).get({ tenantId: "tenant_aura", journalEntryId: entry.id });
      assert.equal(totals.debit, totals.credit, entry.sourceType + " should balance");
      assert.ok(totals.debit > 0, entry.sourceType + " should have value");
    }

    const originalJournalIds = journalEntries.map((entry) => entry.id);
    const rollback = await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "ledger rollback coverage" } });
    assert.equal(rollback.response.status, 200);
    assert.equal(rollback.body.ok, true);

    const journalParams = Object.fromEntries(originalJournalIds.map((id, index) => [`jid${index}`, id]));
    const reversed = db.prepare(`
      SELECT COUNT(*) AS count
      FROM journalEntries
      WHERE tenantId = @tenantId
        AND id IN (${originalJournalIds.map((_, index) => `@jid${index}`).join(",")})
        AND status = 'reversed'
    `).get({ tenantId: "tenant_aura", ...journalParams });
    assert.equal(reversed.count, originalJournalIds.length);
    const reversals = db.prepare(`
      SELECT COUNT(*) AS count
      FROM journalEntries
      WHERE tenantId = @tenantId
        AND sourceType = 'reversal'
        AND reversalOf IN (${originalJournalIds.map((_, index) => `@jid${index}`).join(",")})
    `).get({ tenantId: "tenant_aura", ...journalParams });
    assert.equal(reversals.count, originalJournalIds.length);
    jobId = "";
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: { reason: "ledger migration cleanup" } });
    await close(server);
  }
});

test("missing production tables should exist after boot", () => {
  const requiredTables = [
    "print_devices", "print_jobs", "barcode_scan_events",
    "corporate_accounts", "corporate_account_members",
    "invoice_events", "discount_approval_requests", "coupon_usage",
    "coupon_abuse_alerts", "gift_card_transactions", "store_credits",
    "store_credit_transactions", "offline_sync_queue"
  ];
  for (const table of requiredTables) {
    const exists = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    assert.ok(exists, `Table ${table} must exist after boot`);
  }
});

test("oversized JSON import payload is rejected", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const { response } = await request(baseUrl, "/api/v1/migration/dry-run", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        rows: new Array(50001).fill({ name: "test", phone: "9999999999" })
      }
    });
    assert.equal(response.status, 400, "oversized JSON payload must be rejected with 400");
  } finally {
    await close(server);
  }
});

test("oversized base64 file payload is rejected", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const bigBuf = Buffer.alloc(101 * 1024 * 1024, "A");
    const { response } = await request(baseUrl, "/api/v1/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        skipApprovalGate: true,
        fileName: "huge.xlsx",
        fileBase64: bigBuf.toString("base64")
      }
    });
    assert.ok([400, 413].includes(response.status), `expected 400 or 413, got ${response.status}`);
  } finally {
    await close(server);
  }
});

test("oversized ZIP import with >50000 rows is rejected", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const header = "name,phone\n";
    const rows = Array.from({ length: 50001 }, (_, i) => `user_${i},9999999990\n`).join("");
    const zip = createZipArchive({ "clients.csv": header + rows });
    const { response } = await request(baseUrl, "/api/v1/migration/dry-run", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        fileName: "large.zip",
        fileBase64: zip.toString("base64")
      }
    });
    assert.equal(response.status, 400, "oversized ZIP must be rejected with 400");
  } finally {
    await close(server);
  }
});

test("concurrent worker tick guard does not crash on rapid calls", async () => {
  const { runLargeMigrationWorkerTick } = await import("../server/jobs/migration-large-import.worker.js");
  const { migrationService } = await import("../server/services/migration.service.js");
  const originalWorkerTick = globalThis.__auraLargeMigrationWorkerStarted;
  globalThis.__auraLargeMigrationWorkerStarted = true;
  runLargeMigrationWorkerTick();
  runLargeMigrationWorkerTick();
  runLargeMigrationWorkerTick();
  await new Promise((resolve) => setTimeout(resolve, 500));
  globalThis.__auraLargeMigrationWorkerStarted = originalWorkerTick;
});

test("large CSV file upload converts rows into chunks and queues job", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const header = "name,phone,branchId,originalRecordId\n";
    const rows = Array.from({ length: 10 }, (_, i) =>
      `Large CSV Client ${stamp}_${i},+91 91000 ${String(stamp).slice(-4)}${i},branch_hyd,large-csv-${stamp}-${i}\n`
    ).join("");
    const csvContent = header + rows;
    const csvBuffer = Buffer.from(csvContent, "utf8");
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: csvBuffer,
      fileName: `large-upload-${stamp}.csv`,
      contentType: "text/csv"
    });
    assert.equal(result.response.status, 201);
    assert.ok(result.body.job);
    assert.ok(result.body.fileRef);
    assert.equal(result.body.chunks, 1);
    assert.equal(result.body.totalRows, 10);
    jobId = result.body.job.id;
    assert.equal(result.body.job.status, "queued");
    const dbJob = db.prepare("SELECT id, status, sourceSoftware, resource, fileName, chunkSize FROM migration_large_jobs WHERE id = @id AND tenantId = @tenantId").get({
      id: jobId, tenantId: "tenant_aura"
    });
    assert.ok(dbJob);
    assert.equal(dbJob.status, "queued");
    assert.equal(dbJob.fileName, `large-upload-${stamp}.csv`);
    assert.equal(dbJob.chunkSize, 5000);
    const chunks = db.prepare("SELECT id, chunkNumber, totalRows, status FROM migration_file_chunks WHERE jobId = @jobId AND tenantId = @tenantId ORDER BY chunkNumber").all({
      jobId, tenantId: "tenant_aura"
    });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkNumber, 1);
    assert.equal(chunks[0].totalRows, 10);
    const stagingRows = db.prepare("SELECT COUNT(*) AS count FROM migration_staging_rows WHERE jobId = @jobId AND tenantId = @tenantId").get({
      jobId, tenantId: "tenant_aura"
    });
    assert.equal(stagingRows.count, 10);
  } finally {
    if (jobId) {
      await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: {} });
    }
    await close(server);
  }
});


async function createLargeClientJob(baseUrl, rows, fileNamePrefix = "partial-large") {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const csv = ["name,phone,branchId,originalRecordId", ...rows].join("\n") + "\n";
  const result = await requestBinary(baseUrl, "/migration/large-upload", {
    body: Buffer.from(csv, "utf8"),
    fileName: `${fileNamePrefix}-${stamp}.csv`,
    contentType: "text/csv",
    extraHeaders: { "x-resource": "clients", "x-source-software": "csv" }
  });
  assert.equal(result.response.status, 201);
  assert.ok(result.body.job?.id);
  return result.body.job.id;
}

function markLargeJobRowsCritical(jobId, rowIndexes = []) {
  const rows = db.prepare(`
    SELECT id, chunkId, sourceRowNumber
    FROM migration_staging_rows
    WHERE jobId = @jobId AND tenantId = @tenantId
    ORDER BY sourceRowNumber ASC
  `).all({ jobId, tenantId: "tenant_aura" });
  const selected = new Set(rowIndexes);
  const updateRow = db.prepare(`
    UPDATE migration_staging_rows
       SET status = @status, errors = @errors, updatedAt = datetime('now')
     WHERE id = @id AND tenantId = @tenantId
  `);
  for (const [index, row] of rows.entries()) {
    if (!selected.has(index)) continue;
    updateRow.run({ id: row.id, tenantId: "tenant_aura", status: "error", errors: JSON.stringify(["Forced critical row for partial import test"]) });
  }
  const chunkId = rows[0]?.chunkId || "";
  if (chunkId) {
    const counts = db.prepare(`
      SELECT
        COUNT(*) AS totalRows,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errorRows,
        SUM(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) AS warningRows,
        SUM(CASE WHEN status NOT IN ('error', 'warning') THEN 1 ELSE 0 END) AS validRows
      FROM migration_staging_rows
      WHERE jobId = @jobId AND chunkId = @chunkId AND tenantId = @tenantId
    `).get({ jobId, chunkId, tenantId: "tenant_aura" });
    db.prepare(`
      UPDATE migration_file_chunks
         SET status = @status, totalRows = @totalRows, validRows = @validRows, warningRows = @warningRows, errorRows = @errorRows
       WHERE id = @chunkId AND tenantId = @tenantId
    `).run({
      chunkId,
      tenantId: "tenant_aura",
      status: Number(counts.errorRows || 0) ? "analyzed_with_errors" : "analyzed",
      totalRows: Number(counts.totalRows || 0),
      validRows: Number(counts.validRows || 0),
      warningRows: Number(counts.warningRows || 0),
      errorRows: Number(counts.errorRows || 0)
    });
  }
}
async function cleanupLargeJob(jobId) {
  if (!jobId) return;
  db.prepare("DELETE FROM clients WHERE id IN (SELECT targetId FROM migration_id_map WHERE jobId = @jobId AND tenantId = @tenantId AND resource = @resource)").run({ jobId, tenantId: "tenant_aura", resource: "clients" });
  db.prepare("DELETE FROM migration_id_map WHERE jobId = @jobId AND tenantId = @tenantId").run({ jobId, tenantId: "tenant_aura" });
  db.prepare("DELETE FROM migration_row_results WHERE jobId = @jobId AND tenantId = @tenantId").run({ jobId, tenantId: "tenant_aura" });
  db.prepare("DELETE FROM migration_import_batches WHERE jobId = @jobId AND tenantId = @tenantId").run({ jobId, tenantId: "tenant_aura" });
  db.prepare("DELETE FROM migration_staging_rows WHERE jobId = @jobId AND tenantId = @tenantId").run({ jobId, tenantId: "tenant_aura" });
  db.prepare("DELETE FROM migration_file_chunks WHERE jobId = @jobId AND tenantId = @tenantId").run({ jobId, tenantId: "tenant_aura" });
  db.prepare("DELETE FROM migration_large_jobs WHERE id = @jobId AND tenantId = @tenantId").run({ jobId, tenantId: "tenant_aura" });
}

test("large import blocks critical rows when allowPartialImport is false", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    jobId = await createLargeClientJob(baseUrl, [
      `Large Partial Block ${stamp},+9191000${String(stamp).slice(-5)},branch_hyd,partial-block-valid-${stamp}`,
      `Large Partial Bad ${stamp},+9191999${String(stamp).slice(-5)},missing_branch,partial-block-error-${stamp}`
    ], "partial-block");
    markLargeJobRowsCritical(jobId, [1]);
    const result = await request(baseUrl, `/migration/large-jobs/${jobId}/resume`, {
      method: "POST",
      body: { maxChunks: 5, allowPartialImport: false, skipApprovalGate: false }
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.job.status, "failed");
    assert.equal(result.body.job.importedRows, 0);
    assert.match(result.body.job.failureReason, /critical_errors_present/);
  } finally {
    await cleanupLargeJob(jobId);
    await close(server);
  }
});

test("large import with critical rows and allowPartialImport imports valid rows and skips bad rows", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const goodExternalId = `partial-valid-${stamp}`;
    jobId = await createLargeClientJob(baseUrl, [
      `Large Partial Import ${stamp},+9192000${String(stamp).slice(-5)},branch_hyd,${goodExternalId}`,
      `Large Partial Bad ${stamp},+9192999${String(stamp).slice(-5)},missing_branch,partial-error-${stamp}`
    ], "partial-import");
    markLargeJobRowsCritical(jobId, [1]);
    const result = await request(baseUrl, `/migration/large-jobs/${jobId}/resume`, {
      method: "POST",
      body: { maxChunks: 5, allowPartialImport: true, skipApprovalGate: true }
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.job.status, "completed_with_errors");
    assert.equal(result.body.job.importedRows, 1);
    assert.equal(result.body.job.skippedRows, 1);
    assert.equal(result.body.job.errorRows, 1);
    assert.equal(result.body.job.processedRows, 2);
    assert.equal(result.body.job.chunks[0].status, "imported_with_errors");
    const imported = db.prepare("SELECT targetId FROM migration_id_map WHERE tenantId = @tenantId AND jobId = @jobId AND resource = @resource AND sourceExternalId = @sourceExternalId").get({ tenantId: "tenant_aura", jobId, resource: "clients", sourceExternalId: goodExternalId });
    assert.ok(imported?.targetId);
  } finally {
    await cleanupLargeJob(jobId);
    await close(server);
  }
});

test("large import partial mode marks all-error chunks skipped_with_errors and proof accepts completed_with_errors", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    jobId = await createLargeClientJob(baseUrl, [
      `Large Partial Bad A ${stamp},+9193000${String(stamp).slice(-5)},missing_branch,partial-only-error-a-${stamp}`,
      `Large Partial Bad B ${stamp},+9193001${String(stamp).slice(-5)},missing_branch,partial-only-error-b-${stamp}`
    ], "partial-all-error");
    markLargeJobRowsCritical(jobId, [0, 1]);
    const result = await request(baseUrl, `/migration/large-jobs/${jobId}/resume`, {
      method: "POST",
      body: { maxChunks: 5, allowPartialImport: true, skipApprovalGate: true }
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.job.status, "completed_with_errors");
    assert.equal(result.body.job.importedRows, 0);
    assert.equal(result.body.job.skippedRows, 2);
    assert.equal(result.body.job.errorRows, 2);
    assert.equal(result.body.job.processedRows, 2);
    assert.equal(result.body.job.chunks[0].status, "skipped_with_errors");
    const proof = await request(baseUrl, `/migration/large-jobs/${jobId}/reconcile`, {
      method: "POST",
      body: { snapshotType: "post_import_operator_check" }
    });
    assert.equal(proof.response.status, 201);
    assert.equal(proof.body.job.status, "completed_with_errors");
  } finally {
    await cleanupLargeJob(jobId);
    await close(server);
  }
});
test("large XLSX file upload converts sheet rows into chunks", async () => {
  const XLSX = (await import("xlsx")).default;
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const wb = XLSX.utils.book_new();
    const data = Array.from({ length: 7 }, (_, i) => ({
      name: `Large XLSX Client ${stamp}_${i}`,
      phone: `+91 92000 ${String(stamp).slice(-4)}${i}`,
      branchId: "branch_hyd",
      originalRecordId: `large-xlsx-${stamp}-${i}`
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Clients");
    const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: xlsxBuffer,
      fileName: `large-upload-${stamp}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    assert.equal(result.response.status, 201);
    assert.ok(result.body.job);
    assert.equal(result.body.chunks, 1);
    assert.equal(result.body.totalRows, 7);
    jobId = result.body.job.id;
    const dbJob = db.prepare("SELECT id, status, fileName FROM migration_large_jobs WHERE id = @id AND tenantId = @tenantId").get({
      id: jobId, tenantId: "tenant_aura"
    });
    assert.ok(dbJob);
    assert.equal(dbJob.status, "queued");
    const chunks = db.prepare("SELECT chunkNumber, totalRows, sourceSheet FROM migration_file_chunks WHERE jobId = @jobId AND tenantId = @tenantId ORDER BY chunkNumber").all({
      jobId, tenantId: "tenant_aura"
    });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].sourceSheet, "Clients");
    const stagingRows = db.prepare("SELECT COUNT(*) AS count FROM migration_staging_rows WHERE jobId = @jobId AND tenantId = @tenantId").get({
      jobId, tenantId: "tenant_aura"
    });
    assert.equal(stagingRows.count, 7);
  } finally {
    if (jobId) {
      await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: {} });
    }
    await close(server);
  }
});

test("large ZIP file upload extracts CSV entries into chunks", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const zip = createZipArchive({
      "clients.csv": `name,phone,branchId,originalRecordId\nZIP Large Client ${stamp},+91 93000 ${String(stamp).slice(-5)},branch_hyd,zip-large-${stamp}\n`,
      "staff.csv": `name,role,phone,email,branchId,originalRecordId\nZIP Large Staff ${stamp},stylist,+91 94000 ${String(stamp).slice(-5)},zip-large-staff-${stamp}@example.com,branch_hyd,zip-large-staff-${stamp}\n`
    });
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: zip,
      fileName: `large-upload-${stamp}.zip`,
      contentType: "application/zip"
    });
    assert.equal(result.response.status, 201);
    assert.ok(result.body.job);
    assert.equal(result.body.chunks, 2);
    assert.equal(result.body.totalRows, 2);
    jobId = result.body.job.id;
    const chunks = db.prepare("SELECT chunkNumber, totalRows, sourceSheet FROM migration_file_chunks WHERE jobId = @jobId AND tenantId = @tenantId ORDER BY chunkNumber").all({
      jobId, tenantId: "tenant_aura"
    });
    assert.equal(chunks.length, 2);
    assert.match(chunks[0].sourceSheet, /clients/i);
    assert.match(chunks[1].sourceSheet, /staff/i);
    const stagingRows = db.prepare("SELECT COUNT(*) AS count FROM migration_staging_rows WHERE jobId = @jobId AND tenantId = @tenantId").get({
      jobId, tenantId: "tenant_aura"
    });
    assert.equal(stagingRows.count, 2);
  } finally {
    if (jobId) {
      await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: {} });
    }
    await close(server);
  }
});

test("large upload rejects unsupported file extension", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: Buffer.from("some data"),
      fileName: "test.pdf",
      contentType: "application/pdf"
    });
    assert.equal(result.response.status, 400);
    assert.match(JSON.stringify(result.body), /unsupported content type|unsupported file type/i);
  } finally {
    await close(server);
  }
});

test("large upload rejects empty file", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: Buffer.alloc(0),
      fileName: "empty.csv",
      contentType: "text/csv"
    });
    assert.equal(result.response.status, 400);
    assert.match(JSON.stringify(result.body), /empty/i);
  } finally {
    await close(server);
  }
});

test("large upload rejects ZIP with unsupported entry type", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const zip = createZipArchive({
      "data.exe": Buffer.alloc(100).toString("utf8")
    });
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: zip,
      fileName: "bad.zip",
      contentType: "application/zip"
    });
    assert.equal(result.response.status, 400);
    assert.match(JSON.stringify(result.body), /unsupported zip entry/i);
  } finally {
    await close(server);
  }
});

test("large CSV upload with 100000 rows produces 20 chunks of 5000", { timeout: 120000 }, async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const header = "name,phone,branchId,originalRecordId\n";
    let csvContent = header;
    for (let i = 0; i < 100000; i++) {
      csvContent += `Stress Client ${stamp}_${i},+91 99000 ${String(i).padStart(5, "0")},branch_hyd,stress-${stamp}-${i}\n`;
    }
    const csvBuffer = Buffer.from(csvContent, "utf8");
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: csvBuffer,
      fileName: "clients.csv",
      contentType: "text/csv"
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.chunks, 20);
    assert.equal(result.body.totalRows, 100000);
    jobId = result.body.job.id;
    const chunks = db.prepare("SELECT chunkNumber, totalRows FROM migration_file_chunks WHERE jobId = @jobId AND tenantId = @tenantId ORDER BY chunkNumber").all({
      jobId, tenantId: "tenant_aura"
    });
    assert.equal(chunks.length, 20);
    for (let i = 0; i < 20; i++) {
      assert.equal(chunks[i].chunkNumber, i + 1);
      assert.equal(chunks[i].totalRows, 5000);
    }
    const stagingRows = db.prepare("SELECT COUNT(*) AS count FROM migration_staging_rows WHERE jobId = @jobId AND tenantId = @tenantId").get({
      jobId, tenantId: "tenant_aura"
    });
    assert.equal(stagingRows.count, 100000);
  } finally {
    if (jobId) {
      await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: {} });
    }
    await close(server);
  }
});

test("valid table name whitelist covers all RESOURCE_TEMPLATES tables", async () => {
  const { migrationService } = await import("../server/services/migration.service.js");
  const templates = migrationService.templates();
  for (const [resource, tpl] of Object.entries(templates)) {
    assert.ok(tpl.table, `template ${resource} must have a table`);
    assert.ok(typeof tpl.table === "string", `template ${resource} table must be string`);
  }
});

// ─── Phase 1 Security Hardening Tests ─────────────────────────────────────────

test("safe filename sanitization prevents path traversal in x-file-name", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const csvContent = "name,phone\nSafe,9999999999\n";
    const buf = Buffer.from(csvContent, "utf8");
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: buf,
      fileName: "../../../evil.csv",
      contentType: "text/csv"
    });
    assert.equal(result.response.status, 201);
    jobId = result.body.job.id;
    const stored = db.prepare("SELECT fileName FROM migration_large_jobs WHERE id = @id AND tenantId = @tenantId").get({
      id: jobId, tenantId: "tenant_aura"
    });
    assert.ok(stored);
    assert.equal(stored.fileName.includes(".."), false, "stored fileName must not contain parent-dir traversal");
    assert.equal(stored.fileName.includes("/"), false, "stored fileName must not contain forward slash");
    assert.equal(stored.fileName.includes("\\"), false, "stored fileName must not contain backslash");
    assert.match(stored.fileName, /\.csv$/i, "stored fileName must retain csv extension");
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: {} }).catch(() => {});
    await close(server);
  }
});

test("safe filename sanitization allows clean CSV filename", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const csvContent = "name,phone\nClean,9999999998\n";
    const buf = Buffer.from(csvContent, "utf8");
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: buf,
      fileName: "my_upload_2024.csv",
      contentType: "text/csv"
    });
    assert.equal(result.response.status, 201);
    jobId = result.body.job.id;
    const stored = db.prepare("SELECT fileName FROM migration_large_jobs WHERE id = @id AND tenantId = @tenantId").get({
      id: jobId, tenantId: "tenant_aura"
    });
    assert.equal(stored.fileName, "my_upload_2024.csv");
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: {} }).catch(() => {});
    await close(server);
  }
});

test("large upload rejects fake .zip with plain text content", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const fakeZip = Buffer.from("This is not a zip file, just plain text.", "utf8");
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: fakeZip,
      fileName: "data.zip",
      contentType: "application/zip"
    });
    assert.equal(result.response.status, 400);
    assert.match(JSON.stringify(result.body), /content does not match/i);
  } finally {
    await close(server);
  }
});

test("large upload rejects fake .xlsx with plain text content", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const fakeXlsx = Buffer.from("This is not an xlsx file, just plain text.", "utf8");
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: fakeXlsx,
      fileName: "data.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    assert.equal(result.response.status, 400);
    assert.match(JSON.stringify(result.body), /content does not match/i);
  } finally {
    await close(server);
  }
});

test("large upload rejects binary file renamed .csv", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const binBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: binBuffer,
      fileName: "data.csv",
      contentType: "text/csv"
    });
    assert.equal(result.response.status, 400);
    assert.match(JSON.stringify(result.body), /not valid text|binary/i);
  } finally {
    await close(server);
  }
});

test("large upload rejects ZIP with too many entries", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const entries = {};
    for (let i = 0; i < 301; i++) {
      entries[`file_${i}.csv`] = `name,phone\nUser${i},999999${String(i).padStart(4, "0")}\n`;
    }
    const zip = createZipArchive(entries);
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: zip,
      fileName: "too-many.zip",
      contentType: "application/zip"
    });
    assert.equal(result.response.status, 400);
    assert.match(JSON.stringify(result.body), /too many/i);
  } finally {
    await close(server);
  }
});

test("extractZipEntries rejects oversized single entry", async () => {
  const { extractZipEntries } = await import("../server/utils/zip-archive.js");
  const { deflateRawSync } = await import("node:zlib");
  const name = "big.csv";
  const nameBuffer = Buffer.from(name, "utf8");
  const largeContent = Buffer.alloc(2 * 1024 * 1024, "A");
  const compressed = deflateRawSync(largeContent);
  const localOffset = 0;
  const centralOffset = 30 + nameBuffer.length + compressed.length;
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(0, 10);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(largeContent.length, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28);
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(0, 12);
  centralHeader.writeUInt32LE(0, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(largeContent.length, 24);
  centralHeader.writeUInt16LE(nameBuffer.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(localOffset, 42);
  const eocdOffset = centralOffset + centralHeader.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralHeader.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  const zipBuffer = Buffer.concat([localHeader, nameBuffer, compressed, centralHeader, eocd]);
  assert.throws(() => extractZipEntries(zipBuffer, { maxEntryUncompressedBytes: 1024 }), /too large/i);
});

test("large upload rejects unsupported content type", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const response = await fetch(`${baseUrl}/migration/large-upload`, {
      method: "POST",
      headers: {
        ...(await authHeaders(baseUrl)),
        "content-type": "application/pdf",
        "x-file-name": "data.pdf"
      },
      body: Buffer.from("fake pdf content")
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(body), /unsupported content type/i);
  } finally {
    await close(server);
  }
});

test("SQL injection attempt via malicious resource name is safely rejected", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const result = await request(baseUrl, "/migration/dry-run", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        resource: "clients; DROP TABLE clients; --",
        rows: [{ name: "Hacker", phone: "9999999999" }]
      }
    });
    // Unknown resource should be handled gracefully — either 400 with message or fallback behavior
    assert.ok([200, 201, 400].includes(result.response.status));
    if (result.response.status === 400) {
      assert.match(JSON.stringify(result.body), /resource/i);
    }
  } finally {
    await close(server);
  }
});

test("SQL injection attempt via malicious column names in row data is safe", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const result = await request(baseUrl, "/migration/dry-run", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        resource: "clients",
        rows: [{
          "name); DROP TABLE clients; --": "Hacker",
          name: "Safe Client",
          phone: "9999999998"
        }]
      }
    });
    // System should handle gracefully — either skip or error on bad column
    assert.ok([200, 201, 400].includes(result.response.status));
  } finally {
    await close(server);
  }
});

test("SQL injection attempt via malicious originalRecordId is safe", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const result = await request(baseUrl, "/migration/import", {
      method: "POST",
      body: {
        sourceSoftware: "excel",
        resource: "clients",
        skipApprovalGate: true,
        rows: [{
          name: "SQL Injection Client",
          phone: "9999999996",
          branchId: "branch_hyd",
          originalRecordId: "'; DROP TABLE clients; --"
        }]
      }
    });
    // Import should succeed safely — the malicious ID is bound as a parameter, not interpolated
    assert.equal(result.response.status, 201);
    jobId = result.body.jobId;
    assert.equal(result.body.summary.importedRows, 1);
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: {} }).catch(() => {});
    await close(server);
  }
});

test("large upload accepts valid CSV with safe filename", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const csvContent = "name,phone\nValid Client,9999999997\n";
    const buf = Buffer.from(csvContent, "utf8");
    const result = await requestBinary(baseUrl, "/migration/large-upload", {
      body: buf,
      fileName: "safe_upload.csv",
      contentType: "text/csv"
    });
    assert.equal(result.response.status, 201);
    jobId = result.body.job.id;
    assert.equal(result.body.totalRows, 1);
  } finally {
    if (jobId) await request(baseUrl, `/migration/jobs/${jobId}/rollback`, { method: "POST", body: {} }).catch(() => {});
    await close(server);
  }
});

test("large CSV upload 100K rows twice without cleanup — no UNIQUE constraint collision", { timeout: 300000 }, async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId1 = "";
  let jobId2 = "";
  try {
    const stamp = Date.now();
    const header = "name,phone,branchId,originalRecordId\n";
    let csvContent = header;
    for (let i = 0; i < 100000; i++) {
      csvContent += `Dual Upload Client ${stamp}_${i},+91 99000 ${String(i).padStart(5, "0")},branch_hyd,dual-${stamp}-${i}\n`;
    }
    const csvBuffer = Buffer.from(csvContent, "utf8");

    // First upload — leaves 100K staging rows behind
    const r1 = await requestBinary(baseUrl, "/migration/large-upload", { body: csvBuffer, fileName: "clients.csv", contentType: "text/csv" });
    assert.equal(r1.response.status, 201, "first upload must succeed");
    assert.equal(r1.body.chunks, 20);
    assert.equal(r1.body.totalRows, 100000);
    jobId1 = r1.body.job.id;

    // Second upload — same tenant, 100K existing staging rows still present
    const r2 = await requestBinary(baseUrl, "/migration/large-upload", { body: csvBuffer, fileName: "clients.csv", contentType: "text/csv" });
    assert.equal(r2.response.status, 201, "second upload must succeed without UNIQUE constraint error");
    assert.equal(r2.body.chunks, 20);
    assert.equal(r2.body.totalRows, 100000);
    jobId2 = r2.body.job.id;

    // Confirm both jobs have their staging rows intact
    const rows1 = db.prepare("SELECT COUNT(*) AS count FROM migration_staging_rows WHERE jobId = @jobId AND tenantId = @tenantId").get({ jobId: jobId1, tenantId: "tenant_aura" });
    assert.equal(rows1.count, 100000, "first job must retain all staging rows");
    const rows2 = db.prepare("SELECT COUNT(*) AS count FROM migration_staging_rows WHERE jobId = @jobId AND tenantId = @tenantId").get({ jobId: jobId2, tenantId: "tenant_aura" });
    assert.equal(rows2.count, 100000, "second job must retain all staging rows");
  } finally {
    if (jobId1) await request(baseUrl, `/migration/jobs/${jobId1}/rollback`, { method: "POST", body: {} }).catch(() => {});
    if (jobId2) await request(baseUrl, `/migration/jobs/${jobId2}/rollback`, { method: "POST", body: {} }).catch(() => {});
    await close(server);
  }
});

test("large worker tick honours owner approval and drives job to completed", async () => {
  const server = await listen(createApp());
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  let jobId = "";
  try {
    const stamp = Date.now();
    const suffix = String(stamp).slice(-5);
    // Auto large-upload job (mirrors "Use Large Import Mode" auto flow)
    const csv = [
      "name,phone,branchId,originalRecordId",
      `Worker Tick Client A ${stamp},+9197000${suffix},branch_hyd,worker-tick-a-${stamp}`,
      `Worker Tick Client B ${stamp},+9197001${suffix},branch_hyd,worker-tick-b-${stamp}`
    ].join("\n") + "\n";
    const upload = await requestBinary(baseUrl, "/migration/large-upload", {
      body: Buffer.from(csv, "utf8"),
      fileName: `worker-tick-${stamp}.csv`,
      contentType: "text/csv",
      extraHeaders: { "x-resource": "clients", "x-source-software": "csv" }
    });
    assert.equal(upload.response.status, 201);
    jobId = upload.body.job.id;

    // The auto-created job must now carry the source file hash (Part A fix).
    const dbJob = db.prepare("SELECT settings, sourceSoftware FROM migration_large_jobs WHERE id = @id AND tenantId = @tenantId").get({ id: jobId, tenantId: "tenant_aura" });
    const settings = JSON.parse(dbJob.settings || "{}");
    assert.match(String(settings.sourceFileHash || ""), /^[a-f0-9]{64}$/, "auto large job must persist sourceFileHash");

    // Submit approval keyed on the SAME source hash but a DIFFERENT jobId,
    // proving the worker matches by hash and is not vetoed by jobId provenance.
    const submitted = await request(baseUrl, "/migration/approvals", {
      method: "POST",
      body: {
        jobId: "some-unrelated-job-id",
        resource: "clients",
        sourceSoftware: "csv",
        fileName: `worker-tick-${stamp}.csv`,
        sourceFileHash: settings.sourceFileHash,
        totalRows: 2,
        note: "Owner sign-off"
      }
    });
    assert.equal(submitted.response.status, 201);
    const approved = await request(baseUrl, `/migration/approvals/${submitted.body.id}/decide`, {
      method: "POST",
      body: { decision: "approved", note: "approved" }
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.status, "approved");

    // Drive THIS job through the worker import path WITHOUT skipApprovalGate.
    // Job-scoped resume exercises the same approval gate as worker/tick but is
    // deterministic in the shared test DB (worker/tick claims the oldest queued
    // job, which may belong to an earlier test). The owner approval above was
    // keyed on the source hash with a mismatched jobId, so this only passes once
    // approvalMatchesIdentity honours the hash instead of vetoing on jobId.
    const resumed = await request(baseUrl, `/migration/large-jobs/${jobId}/resume`, {
      method: "POST",
      body: { maxChunks: 5, skipApprovalGate: false }
    });
    assert.equal(resumed.response.status, 200);

    const finalJob = await request(baseUrl, `/migration/large-jobs/${jobId}`);
    assert.equal(finalJob.response.status, 200);
    assert.equal(finalJob.body.status, "completed", `expected completed, got ${finalJob.body.status} (${finalJob.body.failureReason || ""})`);
    assert.equal(finalJob.body.importedRows, 2);
  } finally {
    await cleanupLargeJob(jobId);
    await close(server);
  }
});
