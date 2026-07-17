import { randomUUID } from "node:crypto";
import { columnsFor, db } from "../db.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { invoiceEventLedgerService } from "./invoice-event-ledger.service.js";

const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 12)}`;

function safeColumns(table) {
  try {
    return columnsFor(table);
  } catch {
    return [];
  }
}

function requireTable(table) {
  if (!safeColumns(table).length) throw badRequest(`${table} migration is not applied`);
}

function scopedLookup(table, tenantId, code) {
  const columns = safeColumns(table);
  if (!columns.length) return null;
  const tenantColumn = columns.includes("tenant_id") ? "tenant_id" : columns.includes("tenantId") ? "tenantId" : "";
  const candidates = ["qrCode", "barcode", "sku", "code", "membership_no", "package_no"].filter((column) => columns.includes(column));
  if (!tenantColumn || !candidates.length) return null;
  const where = candidates.map((column) => `${column} = @code`).join(" OR ");
  return db.prepare(`SELECT * FROM ${table} WHERE ${tenantColumn} = @tenantId AND (${where}) LIMIT 1`).get({ tenantId, code }) || null;
}

export class PrintDeviceService {
  listDevices(query = {}, access = {}) {
    requireTable("print_devices");
    const params = [access.tenantId];
    let where = "tenant_id = ?";
    if (query.branchId || query.branch_id || access.branchId) {
      where += " AND branch_id = ?";
      params.push(query.branchId || query.branch_id || access.branchId);
    }
    return db.prepare(`SELECT * FROM print_devices WHERE ${where} ORDER BY created_at DESC`).all(...params);
  }

  createDevice(payload = {}, access = {}) {
    requireTable("print_devices");
    const branchId = payload.branch_id || payload.branchId || access.branchId;
    const terminalId = payload.terminal_id || payload.terminalId;
    if (!branchId || !terminalId) throw badRequest("branch_id and terminal_id are required");
    const id = makeId("pdev");
    db.prepare(
      `INSERT INTO print_devices
        (id, tenant_id, branch_id, terminal_id, device_name, device_type, connection_type, config_json, status, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(
      id,
      access.tenantId,
      branchId,
      terminalId,
      payload.device_name || payload.deviceName || "POS printer",
      payload.device_type || payload.deviceType || "thermal",
      payload.connection_type || payload.connectionType || "browser",
      JSON.stringify(payload.config || payload.config_json || {})
    );
    return db.prepare("SELECT * FROM print_devices WHERE tenant_id = ? AND id = ?").get(access.tenantId, id);
  }

  createJob(payload = {}, access = {}) {
    requireTable("print_jobs");
    const branchId = payload.branch_id || payload.branchId || access.branchId;
    const terminalId = payload.terminal_id || payload.terminalId;
    const invoiceId = payload.invoice_id || payload.invoiceId;
    if (!branchId || !terminalId || !invoiceId) throw badRequest("branch_id, terminal_id and invoice_id are required");
    const id = makeId("pjob");
    db.prepare(
      `INSERT INTO print_jobs
        (id, tenant_id, branch_id, terminal_id, invoice_id, device_id, format, payload_json, status, attempts, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, CURRENT_TIMESTAMP)`
    ).run(
      id,
      access.tenantId,
      branchId,
      terminalId,
      invoiceId,
      payload.device_id || payload.deviceId || "",
      payload.format || "thermal",
      JSON.stringify(payload.payload || {})
    );
    invoiceEventLedgerService.append({
      tenantId: access.tenantId,
      invoiceId,
      eventType: "invoice.printed",
      actorUserId: access.userId || "",
      actorRole: access.role || "",
      payload: { printJobId: id, format: payload.format || "thermal" },
      ip: payload.ip || "",
      userAgent: payload.userAgent || ""
    });
    return this.getJob(id, access);
  }

  listJobs(query = {}, access = {}) {
    requireTable("print_jobs");
    const params = [access.tenantId];
    let where = "tenant_id = ?";
    if (query.status) {
      where += " AND status = ?";
      params.push(query.status);
    }
    if (query.branchId || query.branch_id || access.branchId) {
      where += " AND branch_id = ?";
      params.push(query.branchId || query.branch_id || access.branchId);
    }
    return db.prepare(`SELECT * FROM print_jobs WHERE ${where} ORDER BY created_at DESC LIMIT 100`).all(...params);
  }

  getJob(id, access = {}) {
    const row = db.prepare("SELECT * FROM print_jobs WHERE tenant_id = ? AND id = ?").get(access.tenantId, id);
    if (!row) throw notFound("Print job not found");
    return row;
  }

  retryJob(id, access = {}) {
    const row = this.getJob(id, access);
    db.prepare("UPDATE print_jobs SET status = 'queued', attempts = attempts + 1, last_error = '' WHERE tenant_id = ? AND id = ?").run(access.tenantId, id);
    return { ...row, status: "queued", attempts: Number(row.attempts || 0) + 1 };
  }

  resolveBarcode(payload = {}, access = {}) {
    requireTable("barcode_scan_events");
    const code = payload.code || payload.scanned_code || payload.barcode;
    if (!code) throw badRequest("code is required");
    const lookups = [
      ["product", "products"],
      ["gift_card", "gift_cards"],
      ["membership", "memberships"],
      ["package", "packages"]
    ];
    let resolved = null;
    for (const [type, table] of lookups) {
      const row = scopedLookup(table, access.tenantId, code);
      if (row) {
        resolved = { type, id: row.id, row };
        break;
      }
    }
    const status = resolved ? "resolved" : "not_found";
    const id = makeId("bscan");
    db.prepare(
      `INSERT INTO barcode_scan_events
        (id, tenant_id, branch_id, terminal_id, scanned_code, resolved_entity_type, resolved_entity_id,
         code, scan_type, matched_product_id, result_json, status, created_at)
       VALUES
        (@id, @tenantId, @branchId, @terminalId, @scannedCode, @resolvedType, @resolvedId,
         @code, 'lookup', @matchedProductId, @resultJson, @status, CURRENT_TIMESTAMP)`
    ).run({
      id,
      tenantId: access.tenantId,
      branchId: payload.branch_id || payload.branchId || access.branchId || "",
      terminalId: payload.terminal_id || payload.terminalId || "",
      scannedCode: code,
      resolvedType: resolved?.type || "",
      resolvedId: resolved?.id || "",
      code,
      matchedProductId: resolved?.type === "product" ? resolved.id : "",
      resultJson: JSON.stringify({ matched: Boolean(resolved), type: resolved?.type || "", id: resolved?.id || "" }),
      status
    });
    return { status, resolved, scanId: id };
  }
}

export const printDeviceService = new PrintDeviceService();
