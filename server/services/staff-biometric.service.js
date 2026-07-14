import { db } from "../db.js";
import { badRequest, conflict, notFound } from "../utils/app-error.js";
import { staffOsService } from "./staff-os.service.js";
import { staffOvertimeService } from "./staff-overtime.service.js";
import { generalSettingsService } from "./general-settings.service.js";
import {
  assertBranch,
  branchIdFrom,
  camel,
  emitStaffEvent,
  encryptJson,
  hashPayload,
  makeId,
  managerRoles,
  now,
  payrollRoles,
  requireManager,
  requireRole,
  requireTenant,
  scopedBranchWhere,
  staffAudit,
  staffById,
  toJson
} from "./staff-os-advanced-utils.js";

const supportedProviders = new Set([
  "zkteco",
  "realtime_biometrics",
  "mantra",
  "essl",
  "suprema",
  "aadhaar_ready",
  "camera",
  "web_camera",
  "mobile_camera",
  "rfid",
  "qr",
  "nfc",
  "gps_mobile",
  "branch_beacon",
  "manual"
]);
const punchTypes = new Set(["clock_in", "clock_out"]);

function businessDaysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function hhmmToMinutes(value = "10:00") {
  const [hour, minute] = String(value || "10:00").split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 10) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function minutesFromTimestamp(value) {
  if (!value) return 0;
  const date = new Date(String(value));
  if (!Number.isNaN(date.getTime())) return date.getHours() * 60 + date.getMinutes();
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function uniqueRows(rows = [], key) {
  const seen = new Set();
  return rows.filter((row) => {
    const value = key(row);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export class StaffBiometricService {
  listDevices(query = {}, access) {
    access = requireTenant(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      limit: Math.min(Number(query.limit || 100), 500)
    };
    const filters = [scopedBranchWhere(access, params)];
    if (params.status) filters.push("status = @status");
    return db.prepare(`SELECT * FROM biometric_devices WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT @limit`).all(params).map(camel);
  }

  registerDevice(payload = {}, access) {
    access = requireTenant(access);
    requireManager(access);
    const branchId = branchIdFrom(payload, access);
    assertBranch(access, branchId);
    const provider = String(payload.provider || "manual").toLowerCase();
    if (!supportedProviders.has(provider)) throw badRequest("Unsupported biometric provider");
    const row = {
      id: makeId("bio_dev"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      provider,
      device_code: payload.deviceCode || payload.device_code || "",
      device_name: payload.deviceName || payload.device_name || "",
      device_type: payload.deviceType || payload.device_type || "biometric",
      location_label: payload.locationLabel || payload.location_label || "",
      connection_mode: payload.connectionMode || payload.connection_mode || "offline_sync",
      credentials_encrypted: encryptJson(payload.credentials || {}),
      last_health_status: "unknown",
      status: payload.status || "active",
      created_by: access.userId || ""
    };
    if (!row.device_code) throw badRequest("deviceCode is required");
    try {
      db.transaction(() => {
        db.prepare(`INSERT INTO biometric_devices
          (id, tenant_id, branch_id, provider, device_code, device_name, device_type, location_label, connection_mode, credentials_encrypted, last_health_status, status, created_by)
          VALUES (@id, @tenant_id, @branch_id, @provider, @device_code, @device_name, @device_type, @location_label, @connection_mode, @credentials_encrypted, @last_health_status, @status, @created_by)`).run(row);
        staffAudit("staff.biometric_device_registered", "biometric_devices", row.id, access, { after: { ...row, credentials_encrypted: row.credentials_encrypted ? "[encrypted]" : "" }, branchId });
      })();
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw conflict("Biometric device already exists for this branch");
      throw error;
    }
    emitStaffEvent("staff:biometric_device_registered", access, branchId, row.id);
    return this.getDevice(row.id, access);
  }

  getDevice(id, access) {
    access = requireTenant(access);
    const row = db.prepare("SELECT * FROM biometric_devices WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Biometric device not found");
    assertBranch(access, row.branch_id);
    return camel({ ...row, credentials_encrypted: row.credentials_encrypted ? "[encrypted]" : "" });
  }

  updateDevice(id, payload = {}, access) {
    access = requireTenant(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM biometric_devices WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Biometric device not found");
    assertBranch(access, existing.branch_id);
    if (payload.version !== undefined && Number(payload.version) !== Number(existing.version)) throw conflict("Biometric device was updated by another request");
    const branchId = branchIdFrom(payload, access) || existing.branch_id;
    assertBranch(access, branchId);
    const next = {
      id,
      tenant_id: access.tenantId,
      branch_id: branchId,
      device_name: payload.deviceName ?? payload.device_name ?? existing.device_name,
      location_label: payload.locationLabel ?? payload.location_label ?? existing.location_label,
      connection_mode: payload.connectionMode ?? payload.connection_mode ?? existing.connection_mode,
      credentials_encrypted: payload.credentials ? encryptJson(payload.credentials) : existing.credentials_encrypted,
      status: payload.status ?? existing.status,
      last_health_status: payload.healthStatus ?? payload.last_health_status ?? existing.last_health_status,
      last_seen_at: payload.lastSeenAt ?? payload.last_seen_at ?? existing.last_seen_at,
      version: Number(existing.version || 1) + 1,
      updated_at: now()
    };
    db.transaction(() => {
      db.prepare(`UPDATE biometric_devices SET branch_id = @branch_id, device_name = @device_name, location_label = @location_label,
        connection_mode = @connection_mode, credentials_encrypted = @credentials_encrypted, status = @status,
        last_health_status = @last_health_status, last_seen_at = @last_seen_at, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      staffAudit("staff.biometric_device_updated", "biometric_devices", id, access, { before: existing, after: { ...next, credentials_encrypted: next.credentials_encrypted ? "[encrypted]" : "" }, branchId });
    })();
    return this.getDevice(id, access);
  }

  syncDevice(id, payload = {}, access) {
    access = requireTenant(access);
    requireRole(access, managerRoles, "Only manager/admin/owner can sync biometric devices");
    const device = db.prepare("SELECT * FROM biometric_devices WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!device) throw notFound("Biometric device not found");
    assertBranch(access, device.branch_id);
    const punches = Array.isArray(payload.punches) ? payload.punches : [];
    const run = {
      id: makeId("bio_sync"),
      tenant_id: access.tenantId,
      branch_id: device.branch_id,
      device_id: id,
      status: "running",
      total_events: punches.length,
      created_by: access.userId || ""
    };
    emitStaffEvent("staff:biometric_sync_started", access, device.branch_id, run.id);
    const result = db.transaction(() => {
      db.prepare(`INSERT INTO biometric_sync_runs (id, tenant_id, branch_id, device_id, status, total_events, created_by)
        VALUES (@id, @tenant_id, @branch_id, @device_id, @status, @total_events, @created_by)`).run(run);
      let accepted = 0;
      let duplicates = 0;
      let suspicious = 0;
      const received = [];
      for (const punch of punches) {
        const externalUserId = String(punch.externalUserId || punch.external_user_id || "");
        const punchAt = punch.punchAt || punch.punch_at || now();
        const punchType = punch.punchType || punch.punch_type || "punch";
        const externalEventId = String(punch.externalEventId || punch.external_event_id || hashPayload({ id, externalUserId, punchAt, punchType }));
        const existing = db.prepare("SELECT id FROM biometric_device_logs WHERE tenant_id = ? AND device_id = ? AND external_event_id = ?")
          .get(access.tenantId, id, externalEventId);
        if (existing) {
          duplicates += 1;
          continue;
        }
        const mapping = db.prepare(`SELECT * FROM biometric_staff_mappings
          WHERE tenant_id = ? AND device_id = ? AND external_user_id = ? AND status = 'approved'`).get(access.tenantId, id, externalUserId);
        const suspiciousReason = mapping ? "" : "unmapped external user";
        const log = {
          id: makeId("bio_log"),
          tenant_id: access.tenantId,
          branch_id: device.branch_id,
          device_id: id,
          staff_id: mapping?.staff_id || "",
          external_user_id: externalUserId,
          external_event_id: externalEventId,
          punch_type: punchType,
          punch_at: punchAt,
          raw_event_json: toJson({ ...punch, rawTemplateStored: false }),
          suspicious: suspiciousReason ? 1 : 0,
          suspicious_reason: suspiciousReason,
          status: "received"
        };
        db.prepare(`INSERT INTO biometric_device_logs
          (id, tenant_id, branch_id, device_id, staff_id, external_user_id, external_event_id, punch_type, punch_at, raw_event_json, suspicious, suspicious_reason, status)
          VALUES (@id, @tenant_id, @branch_id, @device_id, @staff_id, @external_user_id, @external_event_id, @punch_type, @punch_at, @raw_event_json, @suspicious, @suspicious_reason, @status)`).run(log);
        const queueKey = `${id}:${externalEventId}`;
        db.prepare(`INSERT INTO biometric_event_queue
          (id, tenant_id, branch_id, sync_run_id, biometric_log_id, staff_id, payload_json, status, idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`).run(makeId("bio_evt"), access.tenantId, device.branch_id, run.id, log.id, log.staff_id, toJson(log), queueKey);
        accepted += 1;
        if (log.suspicious) suspicious += 1;
        received.push(camel(log));
        emitStaffEvent("staff:biometric_punch_received", access, device.branch_id, log.id, { staffId: log.staff_id, suspicious: Boolean(log.suspicious) });
      }
      const completedAt = now();
      db.prepare(`UPDATE biometric_sync_runs SET status = 'completed', completed_at = ?, accepted_events = ?, duplicate_events = ?, suspicious_events = ?
        WHERE id = ? AND tenant_id = ?`).run(completedAt, accepted, duplicates, suspicious, run.id, access.tenantId);
      db.prepare("UPDATE biometric_devices SET last_health_status = 'online', last_seen_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(completedAt, completedAt, id, access.tenantId);
      staffAudit("staff.biometric_sync_completed", "biometric_sync_runs", run.id, access, { after: { accepted, duplicates, suspicious }, branchId: device.branch_id });
      return {
        run: camel(db.prepare("SELECT * FROM biometric_sync_runs WHERE id = ? AND tenant_id = ?").get(run.id, access.tenantId)),
        punches: received,
        duplicateEvents: duplicates,
        suspiciousEvents: suspicious
      };
    })();
    emitStaffEvent("staff:biometric_sync_completed", access, device.branch_id, run.id, result.run);
    return result;
  }

  logs(query = {}, access) {
    access = requireTenant(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      device_id: query.deviceId || query.device_id || "",
      staff_id: query.staffId || query.staff_id || "",
      limit: Math.min(Number(query.limit || 100), 500)
    };
    const filters = [scopedBranchWhere(access, params)];
    if (params.device_id) filters.push("device_id = @device_id");
    if (params.staff_id) filters.push("staff_id = @staff_id");
    return db.prepare(`SELECT * FROM biometric_device_logs WHERE ${filters.join(" AND ")} ORDER BY punch_at DESC LIMIT @limit`).all(params).map(camel);
  }

  listMappings(query = {}, access) {
    access = requireTenant(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      device_id: query.deviceId || query.device_id || "",
      staff_id: query.staffId || query.staff_id || "",
      status: query.status || "",
      limit: Math.min(Number(query.limit || 100), 500)
    };
    const filters = [scopedBranchWhere(access, params, "m")];
    if (params.device_id) filters.push("m.device_id = @device_id");
    if (params.staff_id) filters.push("m.staff_id = @staff_id");
    if (params.status) filters.push("m.status = @status");
    return db.prepare(`SELECT m.*, d.device_name, d.device_code, d.provider, s.full_name, s.employee_code
      FROM biometric_staff_mappings m
      LEFT JOIN biometric_devices d ON d.id = m.device_id AND d.tenant_id = m.tenant_id
      LEFT JOIN staff_master s ON s.id = m.staff_id AND s.tenant_id = m.tenant_id
      WHERE ${filters.join(" AND ")}
      ORDER BY m.status ASC, m.created_at DESC LIMIT @limit`).all(params).map((row) => camel({
        ...row,
        staff_name: row.full_name || row.staff_id,
        device_label: row.device_name || row.device_code || row.device_id
      }));
  }

  registerGateway(payload = {}, access) {
    access = requireTenant(access);
    requireManager(access);
    const branchId = branchIdFrom(payload, access);
    assertBranch(access, branchId);
    const gatewayCode = String(payload.gatewayCode || payload.gateway_code || "").trim();
    if (!gatewayCode) throw badRequest("gatewayCode is required");
    const gatewayApiKey = String(payload.apiKey || payload.api_key || `agw_${crypto.randomUUID().replaceAll("-", "")}`);
    const row = {
      id: makeId("bio_gw"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      gateway_code: gatewayCode,
      display_name: payload.displayName || payload.display_name || gatewayCode,
      machine_name: payload.machineName || payload.machine_name || "",
      os_user: payload.osUser || payload.os_user || "",
      provider_scope_json: toJson(Array.isArray(payload.providers) ? payload.providers : []),
      api_key_hash: hashPayload({ gatewayApiKey }),
      version_label: payload.versionLabel || payload.version_label || "",
      health_status: "registered",
      last_seen_at: now(),
      last_ip: payload.lastIp || payload.last_ip || "",
      config_json: toJson(payload.config || {}),
      status: payload.status || "active",
      created_by: access.userId || ""
    };
    try {
      db.transaction(() => {
        db.prepare(`INSERT INTO biometric_gateway_agents
          (id, tenant_id, branch_id, gateway_code, display_name, machine_name, os_user, provider_scope_json, api_key_hash,
           version_label, health_status, last_seen_at, last_ip, config_json, status, created_by)
          VALUES (@id, @tenant_id, @branch_id, @gateway_code, @display_name, @machine_name, @os_user, @provider_scope_json, @api_key_hash,
           @version_label, @health_status, @last_seen_at, @last_ip, @config_json, @status, @created_by)`).run(row);
        staffAudit("staff.biometric_gateway_registered", "biometric_gateway_agents", row.id, access, { after: { ...row, api_key_hash: "[stored]" }, branchId });
      })();
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw conflict("Gateway already exists for this branch");
      throw error;
    }
    emitStaffEvent("staff:biometric_gateway_registered", access, branchId, row.id);
    return { ...camel({ ...row, api_key_hash: "[stored]" }), gatewayApiKey };
  }

  gatewayManifest(query = {}, access) {
    access = requireTenant(access);
    const branchId = branchIdFrom(query, access);
    assertBranch(access, branchId);
    const devices = this.listDevices({ branchId, limit: 500 }, access);
    const mappings = this.listMappings({ branchId, status: "approved", limit: 1000 }, access);
    const providers = db.prepare(`SELECT * FROM biometric_provider_configs
      WHERE tenant_id = ? AND branch_id = ? AND enabled = 1 ORDER BY provider`).all(access.tenantId, branchId).map(camel);
    return {
      branchId,
      generatedAt: now(),
      ingestion: {
        heartbeat: "/api/v1/staff-os/biometric/gateway/{gatewayId}/heartbeat",
        events: "/api/v1/staff-os/biometric/gateway/{gatewayId}/events",
        acceptedPunchTypes: [...punchTypes]
      },
      providers,
      devices,
      mappings,
      privacy: {
        rawBiometricTemplateAllowed: false,
        edgeSignedEventsPreferred: true,
        imageRetentionDaysDefault: 365
      }
    };
  }

  gatewayHeartbeat(id, payload = {}, access) {
    access = requireTenant(access);
    const gateway = this.getGateway(id, access);
    const branchId = branchIdFrom(payload, access) || gateway.branch_id;
    assertBranch(access, branchId);
    const stamp = now();
    db.prepare(`UPDATE biometric_gateway_agents SET health_status = ?, last_seen_at = ?, last_ip = ?, version_label = COALESCE(NULLIF(?, ''), version_label),
      config_json = COALESCE(NULLIF(?, '{}'), config_json), updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(payload.healthStatus || payload.health_status || "online", stamp, payload.lastIp || payload.last_ip || "", payload.versionLabel || payload.version_label || "", toJson(payload.config || {}), stamp, gateway.id, access.tenantId);
    db.prepare("UPDATE biometric_devices SET last_health_status = 'online', last_seen_at = ?, updated_at = ? WHERE tenant_id = ? AND branch_id = ? AND status = 'active'")
      .run(stamp, stamp, access.tenantId, gateway.branch_id);
    return camel(db.prepare("SELECT * FROM biometric_gateway_agents WHERE id = ? AND tenant_id = ?").get(gateway.id, access.tenantId));
  }

  gatewayEvents(id, payload = {}, access) {
    access = requireTenant(access);
    const gateway = this.getGateway(id, access);
    assertBranch(access, gateway.branch_id);
    const events = Array.isArray(payload.events) ? payload.events : Array.isArray(payload.punches) ? payload.punches : [];
    if (!events.length) throw badRequest("events are required");
    const grouped = new Map();
    for (const event of events) {
      const device = this.resolveGatewayDevice(event, gateway, access);
      const list = grouped.get(device.id) || [];
      list.push({
        externalUserId: event.externalUserId || event.external_user_id,
        externalEventId: event.externalEventId || event.external_event_id,
        punchAt: event.punchAt || event.punch_at || now(),
        punchType: event.punchType || event.punch_type || "clock_in",
        providerPayload: event.payload || event.providerPayload || {}
      });
      grouped.set(device.id, list);
    }
    const syncResults = [];
    for (const [deviceId, punches] of grouped.entries()) {
      syncResults.push(this.syncDevice(deviceId, { punches }, access));
    }
    let processed = null;
    if (payload.processNow || payload.process_now) {
      processed = this.processQueue({ branchId: gateway.branch_id, limit: Math.max(events.length, 100) }, access);
    }
    this.gatewayHeartbeat(gateway.id, { healthStatus: "online", config: { lastBatchSize: events.length } }, access);
    return {
      gateway: camel({ ...gateway, api_key_hash: "[stored]" }),
      acceptedEvents: syncResults.reduce((sum, result) => sum + Number(result.run?.acceptedEvents || 0), 0),
      duplicateEvents: syncResults.reduce((sum, result) => sum + Number(result.duplicateEvents || 0), 0),
      suspiciousEvents: syncResults.reduce((sum, result) => sum + Number(result.suspiciousEvents || 0), 0),
      processed,
      runs: syncResults.map((result) => result.run)
    };
  }

  listConsents(query = {}, access) {
    access = requireTenant(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      staff_id: query.staffId || query.staff_id || "",
      status: query.status || "",
      limit: Math.min(Number(query.limit || 100), 500)
    };
    const filters = [scopedBranchWhere(access, params, "c")];
    if (params.staff_id) filters.push("c.staff_id = @staff_id");
    if (params.status) filters.push("c.consent_status = @status");
    return db.prepare(`SELECT c.*, s.full_name, s.employee_code
      FROM staff_biometric_consents c
      LEFT JOIN staff_master s ON s.id = c.staff_id AND s.tenant_id = c.tenant_id
      WHERE ${filters.join(" AND ")}
      ORDER BY c.updated_at DESC, c.created_at DESC LIMIT @limit`).all(params).map((row) => camel({
        ...row,
        staff_name: row.full_name || row.staff_id
      }));
  }

  upsertConsent(payload = {}, access) {
    access = requireTenant(access);
    requireManager(access);
    const staff = staffById(payload.staffId || payload.staff_id, access);
    const branchId = branchIdFrom(payload, access) || staff.branch_id;
    assertBranch(access, branchId);
    const consentType = payload.consentType || payload.consent_type || "biometric_attendance";
    const status = payload.consentStatus || payload.consent_status || "granted";
    const existing = db.prepare("SELECT * FROM staff_biometric_consents WHERE tenant_id = ? AND staff_id = ? AND consent_type = ?")
      .get(access.tenantId, staff.id, consentType);
    const row = {
      id: existing?.id || makeId("bio_con"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      staff_id: staff.id,
      consent_type: consentType,
      consent_status: status,
      consent_channel: payload.consentChannel || payload.consent_channel || existing?.consent_channel || "paper",
      consent_text: payload.consentText || payload.consent_text || existing?.consent_text || "",
      retention_days: Number(payload.retentionDays ?? payload.retention_days ?? existing?.retention_days ?? 365),
      delete_requested: payload.deleteRequested || payload.delete_requested ? 1 : Number(existing?.delete_requested || 0),
      delete_requested_at: payload.deleteRequested || payload.delete_requested ? now() : existing?.delete_requested_at || null,
      granted_at: status === "granted" ? (existing?.granted_at || now()) : existing?.granted_at || null,
      revoked_at: status === "revoked" ? now() : existing?.revoked_at || null,
      metadata_json: toJson(payload.metadata || {}),
      created_by: access.userId || ""
    };
    db.transaction(() => {
      if (existing) {
        db.prepare(`UPDATE staff_biometric_consents SET branch_id = @branch_id, consent_status = @consent_status, consent_channel = @consent_channel,
          consent_text = @consent_text, retention_days = @retention_days, delete_requested = @delete_requested, delete_requested_at = @delete_requested_at,
          granted_at = @granted_at, revoked_at = @revoked_at, metadata_json = @metadata_json, updated_at = CURRENT_TIMESTAMP
          WHERE id = @id AND tenant_id = @tenant_id`).run(row);
      } else {
        db.prepare(`INSERT INTO staff_biometric_consents
          (id, tenant_id, branch_id, staff_id, consent_type, consent_status, consent_channel, consent_text, retention_days, delete_requested,
           delete_requested_at, granted_at, revoked_at, metadata_json, created_by)
          VALUES (@id, @tenant_id, @branch_id, @staff_id, @consent_type, @consent_status, @consent_channel, @consent_text, @retention_days, @delete_requested,
           @delete_requested_at, @granted_at, @revoked_at, @metadata_json, @created_by)`).run(row);
      }
      staffAudit("staff.biometric_consent_upserted", "staff_biometric_consents", row.id, access, { before: existing, after: row, branchId });
    })();
    emitStaffEvent("staff:biometric_consent_upserted", access, branchId, row.id, { staffId: staff.id, status });
    return camel(db.prepare("SELECT * FROM staff_biometric_consents WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  requestConsentDeletion(id, payload = {}, access) {
    access = requireTenant(access);
    requireManager(access);
    const row = db.prepare("SELECT * FROM staff_biometric_consents WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Biometric consent not found");
    assertBranch(access, row.branch_id);
    db.transaction(() => {
      db.prepare(`UPDATE staff_biometric_consents SET delete_requested = 1, delete_requested_at = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`).run(now(), toJson({ reason: payload.reason || "" }), id, access.tenantId);
      staffAudit("staff.biometric_consent_delete_requested", "staff_biometric_consents", id, access, { before: row, branchId: row.branch_id });
    })();
    return camel(db.prepare("SELECT * FROM staff_biometric_consents WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
  }

  attendanceCenter(query = {}, access) {
    access = requireTenant(access);
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || access.branchId || "";
    assertBranch(access, branchId);
    const date = query.date || now().slice(0, 10);
    const from = query.from || date;
    const to = query.to || date;
    const limit = Math.min(Number(query.limit || 80), 250);
    const devices = this.listDevices({ branchId, limit: 200 }, access);
    const logs = this.logs({ branchId, limit }, access);
    const attendance = db.prepare(`SELECT a.*, s.first_name, s.last_name, s.employee_code
      FROM staff_attendance_logs a
      LEFT JOIN staff_master s ON s.id = a.staff_id AND s.tenant_id = a.tenant_id
      WHERE a.tenant_id = @tenant_id AND a.branch_id = @branch_id AND a.business_date >= @from AND a.business_date <= @to
      ORDER BY a.business_date DESC, a.created_at DESC
      LIMIT @limit`).all({ tenant_id: access.tenantId, branch_id: branchId, from, to, limit }).map((row) => camel({
        ...row,
        staff_name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim()
      }));
    const cameraEvidence = db.prepare(`SELECT e.*, s.first_name, s.last_name, s.employee_code
      FROM staff_attendance_camera_evidence e
      LEFT JOIN staff_master s ON s.id = e.staff_id AND s.tenant_id = e.tenant_id
      WHERE e.tenant_id = @tenant_id AND e.branch_id = @branch_id AND e.business_date >= @from AND e.business_date <= @to
      ORDER BY e.captured_at DESC
      LIMIT @limit`).all({ tenant_id: access.tenantId, branch_id: branchId, from, to, limit }).map((row) => camel({
        ...row,
        staff_name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
        image_data_url: row.image_data_url ? "[stored]" : ""
      }));
    const queue = db.prepare(`SELECT status, COUNT(*) AS count FROM biometric_event_queue
      WHERE tenant_id = @tenant_id AND branch_id = @branch_id
      GROUP BY status`).all({ tenant_id: access.tenantId, branch_id: branchId }).map(camel);
    const gateways = db.prepare(`SELECT * FROM biometric_gateway_agents
      WHERE tenant_id = @tenant_id AND branch_id = @branch_id ORDER BY updated_at DESC LIMIT 50`)
      .all({ tenant_id: access.tenantId, branch_id: branchId }).map((row) => camel({ ...row, api_key_hash: row.api_key_hash ? "[stored]" : "" }));
    const mappings = this.listMappings({ branchId, limit: 100 }, access);
    const consents = this.listConsents({ branchId, limit: 100 }, access);
    const risks = this.attendanceRisks({ branchId, limit: 80 }, access);
    const payrollPreview = this.payrollPreviewRows({ branchId, periodStart: from, periodEnd: to, limit: 80 }, access);
    const alerts = this.ownerAlerts({ branchId, limit: 40 }, access);
    return {
      branchId,
      date,
      range: { from, to },
      summary: {
        devices: devices.length,
        onlineDevices: devices.filter((device) => device.lastHealthStatus === "online").length,
        activeDevices: devices.filter((device) => device.status === "active").length,
        gateways: gateways.length,
        onlineGateways: gateways.filter((gateway) => gateway.healthStatus === "online" || gateway.healthStatus === "registered").length,
        mappedStaff: mappings.filter((item) => item.status === "approved").length,
        consentGranted: consents.filter((item) => item.consentStatus === "granted").length,
        consentPending: consents.filter((item) => item.consentStatus !== "granted").length,
        attendanceEvents: attendance.length,
        cameraCaptures: cameraEvidence.length,
        suspiciousEvents: logs.filter((log) => Boolean(log.suspicious)).length + cameraEvidence.filter((item) => Boolean(item.suspicious)).length + risks.filter((risk) => risk.status === "open").length,
        queuedEvents: queue.find((item) => item.status === "queued")?.count || 0,
        failedEvents: queue.find((item) => item.status === "failed")?.count || 0,
        payrollPreviewRows: payrollPreview.length,
        ownerAlerts: alerts.filter((alert) => alert.status === "queued").length
      },
      devices,
      gateways,
      mappings,
      consents,
      logs,
      cameraEvidence,
      attendance,
      risks,
      payrollPreview,
      alerts,
      queue
    };
  }

  attendanceRisks(query = {}, access) {
    access = requireTenant(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      staff_id: query.staffId || query.staff_id || "",
      status: query.status || "",
      limit: Math.min(Number(query.limit || 100), 500)
    };
    const filters = [scopedBranchWhere(access, params)];
    if (params.staff_id) filters.push("staff_id = @staff_id");
    if (params.status) filters.push("status = @status");
    return db.prepare(`SELECT * FROM staff_attendance_risk_events WHERE ${filters.join(" AND ")}
      ORDER BY created_at DESC LIMIT @limit`).all(params).map(camel);
  }

  payrollPreviewRows(query = {}, access) {
    access = requireTenant(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      period_start: query.periodStart || query.period_start || "",
      period_end: query.periodEnd || query.period_end || "",
      staff_id: query.staffId || query.staff_id || "",
      limit: Math.min(Number(query.limit || 100), 500)
    };
    const filters = [scopedBranchWhere(access, params)];
    if (params.staff_id) filters.push("staff_id = @staff_id");
    if (params.period_start) filters.push("period_start >= @period_start");
    if (params.period_end) filters.push("period_end <= @period_end");
    return db.prepare(`SELECT * FROM staff_attendance_payroll_previews WHERE ${filters.join(" AND ")}
      ORDER BY period_end DESC, created_at DESC LIMIT @limit`).all(params).map(camel);
  }

  ownerAlerts(query = {}, access) {
    access = requireTenant(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      limit: Math.min(Number(query.limit || 100), 500)
    };
    const filters = [scopedBranchWhere(access, params)];
    if (params.status) filters.push("status = @status");
    return db.prepare(`SELECT * FROM owner_command_alerts WHERE ${filters.join(" AND ")}
      ORDER BY created_at DESC LIMIT @limit`).all(params).map(camel);
  }

  payrollAutopilotPreview(payload = {}, access) {
    access = requireTenant(access);
    requireRole(access, payrollRoles, "Only owner/admin/accountant can run attendance payroll autopilot");
    const branchId = branchIdFrom(payload, access);
    assertBranch(access, branchId);
    const periodStart = payload.periodStart || payload.period_start;
    const periodEnd = payload.periodEnd || payload.period_end;
    if (!periodStart || !periodEnd) throw badRequest("periodStart and periodEnd are required");
    const rules = {
      defaultShiftStart: payload.defaultShiftStart || payload.default_shift_start || "10:00",
      lateGraceMinutes: Number(payload.lateGraceMinutes ?? payload.late_grace_minutes ?? 15),
      incentiveHoldAbsentDays: Number(payload.incentiveHoldAbsentDays ?? payload.incentive_hold_absent_days ?? 2),
      latePenaltyAmount: Number(payload.latePenaltyAmount ?? payload.late_penalty_amount ?? 0),
      defaultGrossAmount: Number(payload.defaultGrossAmount ?? payload.default_gross_amount ?? 0)
    };
    const staffRows = staffOsService.listStaff({ branchId, status: "active", limit: 1000 }, access);
    const periodDays = businessDaysBetween(periodStart, periodEnd);
    const threshold = hhmmToMinutes(rules.defaultShiftStart) + rules.lateGraceMinutes;
    const previews = [];
    const periodOvertimeByStaff = staffOvertimeService.periodTotalsByStaff({
      tenantId: access.tenantId,
      branchId,
      periodStart,
      periodEnd
    });
    db.transaction(() => {
      for (const staff of staffRows) {
        const attendance = db.prepare(`SELECT * FROM staff_attendance_logs
          WHERE tenant_id = @tenantId AND branch_id = @branchId AND staff_id = @staffId AND business_date >= @periodStart AND business_date <= @periodEnd
          ORDER BY business_date ASC`).all({ tenantId: access.tenantId, branchId, staffId: staff.id, periodStart, periodEnd });
        const presentDays = uniqueRows(attendance.filter((row) => row.clock_in_at), (row) => row.business_date).length;
        const lateCount = attendance.filter((row) => row.clock_in_at && minutesFromTimestamp(row.clock_in_at) > threshold).length;
        const overtimeMinutes = Number(periodOvertimeByStaff.get(String(staff.id)) || 0);
        const salary = staff.employeeDetails?.attendanceSalary || {};
        const gross = Number(salary.basicSalary || rules.defaultGrossAmount || 0);
        const absentDays = Math.max(periodDays - presentDays, 0);
        const daily = periodDays > 0 ? gross / periodDays : 0;
        const attendanceDeduction = Math.round((absentDays * daily + lateCount * rules.latePenaltyAmount) * 100) / 100;
        const overtimeAmount = Math.round((overtimeMinutes / 60) * Number(salary.otExtraRate || 0) * 100) / 100;
        const preview = {
          id: makeId("att_pay"),
          tenant_id: access.tenantId,
          branch_id: branchId,
          staff_id: staff.id,
          period_start: periodStart,
          period_end: periodEnd,
          present_days: presentDays,
          absent_days: absentDays,
          late_count: lateCount,
          half_days: 0,
          overtime_minutes: overtimeMinutes,
          less_work_minutes: 0,
          incentive_hold: absentDays >= rules.incentiveHoldAbsentDays ? 1 : 0,
          gross_amount: gross,
          attendance_deduction: attendanceDeduction,
          overtime_amount: overtimeAmount,
          net_preview: Math.max(gross - attendanceDeduction + overtimeAmount, 0),
          rules_json: toJson(rules),
          status: "draft",
          created_by: access.userId || ""
        };
        db.prepare(`INSERT INTO staff_attendance_payroll_previews
          (id, tenant_id, branch_id, staff_id, period_start, period_end, present_days, absent_days, late_count, half_days,
           overtime_minutes, less_work_minutes, incentive_hold, gross_amount, attendance_deduction, overtime_amount, net_preview, rules_json, status, created_by)
          VALUES (@id, @tenant_id, @branch_id, @staff_id, @period_start, @period_end, @present_days, @absent_days, @late_count, @half_days,
           @overtime_minutes, @less_work_minutes, @incentive_hold, @gross_amount, @attendance_deduction, @overtime_amount, @net_preview, @rules_json, @status, @created_by)
          ON CONFLICT(tenant_id, staff_id, period_start, period_end) DO UPDATE SET
            branch_id = excluded.branch_id, present_days = excluded.present_days, absent_days = excluded.absent_days, late_count = excluded.late_count,
            overtime_minutes = excluded.overtime_minutes, incentive_hold = excluded.incentive_hold, gross_amount = excluded.gross_amount,
            attendance_deduction = excluded.attendance_deduction, overtime_amount = excluded.overtime_amount, net_preview = excluded.net_preview,
            rules_json = excluded.rules_json, updated_at = CURRENT_TIMESTAMP`).run(preview);
        previews.push({ ...camel(preview), staffName: staff.fullName, employeeCode: staff.employeeCode });
        if (preview.incentive_hold) {
          this.queueOwnerAlert({
            branchId,
            alertType: "attendance_incentive_hold",
            title: "Attendance incentive hold",
            body: `${staff.fullName} has ${absentDays} absent day(s) in payroll preview.`,
            severity: "warning",
            referenceType: "staff",
            referenceId: staff.id,
            idempotencyKey: `payroll-hold:${access.tenantId}:${staff.id}:${periodStart}:${periodEnd}`
          }, access);
        }
      }
      staffAudit("staff.attendance_payroll_preview_generated", "staff_attendance_payroll_previews", makeId("att_pay_audit"), access, { after: { rows: previews.length, periodStart, periodEnd }, branchId });
    })();
    emitStaffEvent("staff:attendance_payroll_preview_generated", access, branchId, makeId("att_pay_evt"), { rows: previews.length });
    return { branchId, periodStart, periodEnd, rules, rows: previews };
  }

  runFraudScan(payload = {}, access) {
    access = requireTenant(access);
    requireManager(access);
    const branchId = branchIdFrom(payload, access);
    assertBranch(access, branchId);
    const date = payload.date || now().slice(0, 10);
    const from = payload.from || payload.periodStart || date;
    const to = payload.to || payload.periodEnd || date;
    const created = [];
    const suspiciousLogs = db.prepare(`SELECT * FROM biometric_device_logs
      WHERE tenant_id = ? AND branch_id = ? AND punch_at >= ? AND punch_at <= ? AND suspicious = 1
      ORDER BY punch_at DESC LIMIT 200`).all(access.tenantId, branchId, `${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`);
    for (const log of suspiciousLogs) {
      created.push(this.recordRiskEvent({
        branchId,
        staffId: log.staff_id || "",
        sourceType: "biometric",
        riskType: log.staff_id ? "suspicious_biometric_event" : "unmapped_biometric_user",
        severity: log.staff_id ? "medium" : "high",
        riskScore: log.staff_id ? 65 : 80,
        reason: log.suspicious_reason || "Suspicious biometric punch",
        evidence: log,
        referenceId: log.id,
        idempotencyKey: `bio-risk:${access.tenantId}:${log.id}`
      }, access));
    }
    const evidenceRows = db.prepare(`SELECT * FROM staff_attendance_camera_evidence
      WHERE tenant_id = ? AND branch_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY captured_at DESC LIMIT 300`).all(access.tenantId, branchId, from, to);
    for (const evidence of evidenceRows.filter((row) => Number(row.suspicious || 0) === 1 || Number(row.liveness_score || 0) < 0.5 || Number(row.match_score || 0) < 0.5)) {
      created.push(this.recordRiskEvent({
        branchId,
        staffId: evidence.staff_id,
        attendanceId: evidence.attendance_id || "",
        sourceType: "camera",
        riskType: "camera_liveness_or_match_risk",
        severity: Number(evidence.liveness_score || 0) < 0.4 || Number(evidence.match_score || 0) < 0.4 ? "high" : "medium",
        riskScore: Math.round((1 - Math.min(Number(evidence.liveness_score || 0), Number(evidence.match_score || 0))) * 100),
        reason: evidence.suspicious_reason || "Camera punch requires review",
        evidence,
        referenceId: evidence.id,
        idempotencyKey: `camera-risk:${access.tenantId}:${evidence.id}`
      }, access));
    }
    const duplicateFaces = db.prepare(`SELECT image_hash, COUNT(DISTINCT staff_id) AS staff_count, GROUP_CONCAT(DISTINCT staff_id) AS staff_ids
      FROM staff_attendance_camera_evidence
      WHERE tenant_id = ? AND branch_id = ? AND business_date >= ? AND business_date <= ? AND image_hash != ''
      GROUP BY image_hash HAVING staff_count > 1`).all(access.tenantId, branchId, from, to);
    for (const duplicate of duplicateFaces) {
      created.push(this.recordRiskEvent({
        branchId,
        sourceType: "camera",
        riskType: "same_face_multiple_staff",
        severity: "critical",
        riskScore: 95,
        reason: "Same camera face hash used for multiple staff profiles",
        evidence: duplicate,
        idempotencyKey: `same-face:${access.tenantId}:${branchId}:${duplicate.image_hash}:${from}:${to}`
      }, access));
    }
    const offlineCutoff = new Date(Date.now() - Number(payload.offlineMinutes || 30) * 60000).toISOString();
    const offlineDevices = db.prepare(`SELECT * FROM biometric_devices
      WHERE tenant_id = ? AND branch_id = ? AND status = 'active' AND (last_seen_at IS NULL OR last_seen_at < ?)`).all(access.tenantId, branchId, offlineCutoff);
    for (const device of offlineDevices) {
      this.queueOwnerAlert({
        branchId,
        alertType: "biometric_device_offline",
        title: "Biometric device offline",
        body: `${device.device_name || device.device_code} has not sent heartbeat recently.`,
        severity: "warning",
        referenceType: "biometric_device",
        referenceId: device.id,
        idempotencyKey: `device-offline:${access.tenantId}:${device.id}:${date}`
      }, access);
    }
    const openRisks = this.attendanceRisks({ branchId, status: "open", limit: 200 }, access);
    if (openRisks.length) {
      this.queueOwnerAlert({
        branchId,
        alertType: "attendance_fraud_risk",
        title: "Attendance risk review",
        body: `${openRisks.length} open attendance risk event(s) need review.`,
        severity: openRisks.some((risk) => risk.severity === "critical" || risk.severity === "high") ? "critical" : "warning",
        referenceType: "staff_attendance_risk_events",
        referenceId: branchId,
        idempotencyKey: `attendance-risk-summary:${access.tenantId}:${branchId}:${from}:${to}`
      }, access);
    }
    return {
      branchId,
      range: { from, to },
      created: created.filter(Boolean),
      openRisks: this.attendanceRisks({ branchId, status: "open", limit: 200 }, access),
      alerts: this.ownerAlerts({ branchId, status: "queued", limit: 100 }, access)
    };
  }

  processQueue(payload = {}, access) {
    access = requireTenant(access);
    requireRole(access, managerRoles, "Only manager/admin/owner can process biometric attendance");
    const branchId = branchIdFrom(payload, access);
    assertBranch(access, branchId);
    const limit = Math.min(Number(payload.limit || 100), 300);
    const rows = db.prepare(`SELECT * FROM biometric_event_queue
      WHERE tenant_id = @tenant_id AND branch_id = @branch_id AND status = 'queued'
      ORDER BY created_at ASC LIMIT @limit`).all({ tenant_id: access.tenantId, branch_id: branchId, limit });
    const results = [];
    for (const row of rows) {
      const event = this.parsePayload(row.payload_json);
      const punchType = event.punch_type || event.punchType || "clock_in";
      const punchAt = event.punch_at || event.punchAt || now();
      const staffId = row.staff_id || event.staff_id || event.staffId || "";
      try {
        if (!staffId) throw badRequest("Biometric event is not mapped to a staff profile");
        const attendancePayload = {
          staffId,
          branchId: row.branch_id,
          businessDate: String(punchAt).slice(0, 10),
          source: "biometric",
          deviceId: event.device_id || event.deviceId || "",
          ...(punchType === "clock_out" ? { clockOutAt: punchAt } : { clockInAt: punchAt })
        };
        const attendance = punchType === "clock_out"
          ? staffOsService.clockOut(attendancePayload, access)
          : staffOsService.clockIn(attendancePayload, access);
        db.prepare(`UPDATE biometric_event_queue SET status = 'processed', processed_at = ? WHERE id = ? AND tenant_id = ?`)
          .run(now(), row.id, access.tenantId);
        if (row.biometric_log_id) {
          db.prepare("UPDATE biometric_device_logs SET status = 'processed' WHERE id = ? AND tenant_id = ?").run(row.biometric_log_id, access.tenantId);
        }
        results.push({ id: row.id, status: "processed", attendanceId: attendance.id, punchType, staffId });
      } catch (error) {
        db.prepare(`UPDATE biometric_event_queue SET status = 'failed', processed_at = ? WHERE id = ? AND tenant_id = ?`)
          .run(now(), row.id, access.tenantId);
        if (row.biometric_log_id) {
          db.prepare("UPDATE biometric_device_logs SET status = 'failed', suspicious = 1, suspicious_reason = ? WHERE id = ? AND tenant_id = ?")
            .run(error.message || "Unable to process biometric event", row.biometric_log_id, access.tenantId);
        }
        this.recordRiskEvent({
          branchId: row.branch_id,
          staffId,
          sourceType: "biometric",
          riskType: staffId ? "biometric_processing_failed" : "unmapped_biometric_user",
          severity: staffId ? "medium" : "high",
          riskScore: staffId ? 60 : 85,
          reason: error.message || "Unable to process biometric event",
          evidence: { queueId: row.id, biometricLogId: row.biometric_log_id || "", event },
          referenceId: row.id,
          idempotencyKey: `queue-risk:${access.tenantId}:${row.id}`
        }, access);
        results.push({ id: row.id, status: "failed", reason: error.message || "Unable to process biometric event", punchType, staffId });
      }
    }
    emitStaffEvent("staff:biometric_queue_processed", access, branchId, makeId("bio_proc"), { processed: results.length });
    return {
      branchId,
      processed: results.filter((item) => item.status === "processed").length,
      failed: results.filter((item) => item.status === "failed").length,
      results
    };
  }

  cameraPunch(payload = {}, access) {
    access = requireTenant(access);
    const staff = staffById(payload.staffId || payload.staff_id, access);
    const branchId = branchIdFrom(payload, access) || staff.branch_id;
    assertBranch(access, branchId);
    if (staff.branch_id && staff.branch_id !== branchId) throw badRequest("Staff does not belong to selected branch");
    const punchType = payload.punchType || payload.punch_type || "clock_in";
    if (!punchTypes.has(punchType)) throw badRequest("punchType must be clock_in or clock_out");
    const edgeVerified = Boolean(payload.edgeVerified || payload.edge_verified);
    const signedEvent = String(payload.signedEvent || payload.signed_event || "");
    const edgeSignature = String(payload.edgeSignature || payload.edge_signature || "");
    const imageDataUrl = String(payload.imageDataUrl || payload.image_data_url || "");
    if (!edgeVerified && !imageDataUrl.startsWith("data:image/")) throw badRequest("Camera imageDataUrl is required unless edgeVerified is true");
    if (edgeVerified && !(payload.imageHash || payload.image_hash) && !signedEvent) throw badRequest("imageHash or signedEvent is required for edge verified camera punch");
    if (imageDataUrl.length > 2_000_000) throw badRequest("Camera image is too large");
    const capturedAt = payload.capturedAt || payload.captured_at || now();
    const businessDate = payload.businessDate || payload.business_date || String(capturedAt).slice(0, 10);
    const device = payload.deviceId || payload.device_id
      ? this.getDevice(payload.deviceId || payload.device_id, access)
      : this.ensureCameraDevice(branchId, access);
    const imageHash = String(payload.imageHash || payload.image_hash || (imageDataUrl ? hashPayload({ imageDataUrl }) : hashPayload({ signedEvent, edgeSignature })));
    const externalEventId = payload.externalEventId || payload.external_event_id || hashPayload({ staffId: staff.id, punchType, capturedAt, imageHash });
    const duplicateLog = db.prepare("SELECT id FROM biometric_device_logs WHERE tenant_id = ? AND device_id = ? AND external_event_id = ?")
      .get(access.tenantId, device.id, externalEventId);
    if (duplicateLog) throw conflict("Camera attendance event already exists");
    const evidenceId = makeId("cam_att");
    const selfieUrl = `camera-evidence:${evidenceId}`;
    const attendancePayload = {
      branchId,
      staffId: staff.id,
      businessDate,
      source: "camera",
      deviceId: device.id,
      selfieUrl,
      gpsLat: payload.gpsLat ?? payload.gps_lat ?? null,
      gpsLng: payload.gpsLng ?? payload.gps_lng ?? null,
      ...(punchType === "clock_out" ? { clockOutAt: capturedAt } : { clockInAt: capturedAt })
    };
    const attendance = punchType === "clock_out"
      ? staffOsService.clockOut(attendancePayload, access)
      : staffOsService.clockIn(attendancePayload, access);
    const livenessChecks = payload.livenessChecks || payload.liveness_checks || {};
    const derivedLivenessScore = this.deriveLivenessScore(livenessChecks);
    const livenessScore = Number(payload.livenessScore ?? payload.liveness_score ?? derivedLivenessScore ?? 0);
    const matchScore = Number(payload.matchScore ?? payload.match_score ?? (edgeVerified ? 0.95 : 0));
    const suspiciousReasons = [];
    if (!this.hasConsent(staff.id, access)) suspiciousReasons.push("biometric consent missing");
    if (edgeVerified && (!signedEvent || !edgeSignature)) suspiciousReasons.push("edge event not fully signed");
    if ((payload.livenessScore ?? payload.liveness_score) !== undefined && livenessScore < 0.5) suspiciousReasons.push("low liveness score");
    if ((payload.matchScore ?? payload.match_score) !== undefined && matchScore < 0.5) suspiciousReasons.push("low face match score");
    const evidence = {
      id: evidenceId,
      tenant_id: access.tenantId,
      branch_id: branchId,
      staff_id: staff.id,
      attendance_id: attendance.id,
      device_id: device.id,
      capture_type: punchType,
      captured_at: capturedAt,
      business_date: businessDate,
      image_data_url: edgeVerified ? "" : imageDataUrl,
      image_hash: imageHash,
      liveness_score: Number.isFinite(livenessScore) ? livenessScore : 0,
      match_score: Number.isFinite(matchScore) ? matchScore : 0,
      gps_lat: payload.gpsLat ?? payload.gps_lat ?? null,
      gps_lng: payload.gpsLng ?? payload.gps_lng ?? null,
      source: edgeVerified ? "edge_camera" : "camera",
      review_status: suspiciousReasons.length ? "review_required" : "auto_accepted",
      suspicious: suspiciousReasons.length ? 1 : 0,
      suspicious_reason: suspiciousReasons.join(", "),
      notes: payload.notes || "",
      created_by: access.userId || ""
    };
    const log = {
      id: makeId("bio_log"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      device_id: device.id,
      staff_id: staff.id,
      external_user_id: staff.employee_code || staff.id,
      external_event_id: externalEventId,
      punch_type: punchType,
      punch_at: capturedAt,
      raw_event_json: toJson({ evidenceId, imageHash, livenessScore: evidence.liveness_score, matchScore: evidence.match_score, edgeVerified, signedEvent: signedEvent ? "[present]" : "", rawImageStored: Boolean(evidence.image_data_url) }),
      suspicious: evidence.suspicious,
      suspicious_reason: evidence.suspicious_reason,
      status: "processed"
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_attendance_camera_evidence
        (id, tenant_id, branch_id, staff_id, attendance_id, device_id, capture_type, captured_at, business_date, image_data_url, image_hash,
         liveness_score, match_score, gps_lat, gps_lng, source, review_status, suspicious, suspicious_reason, notes, created_by)
        VALUES (@id, @tenant_id, @branch_id, @staff_id, @attendance_id, @device_id, @capture_type, @captured_at, @business_date, @image_data_url, @image_hash,
         @liveness_score, @match_score, @gps_lat, @gps_lng, @source, @review_status, @suspicious, @suspicious_reason, @notes, @created_by)`).run(evidence);
      db.prepare(`INSERT INTO biometric_device_logs
        (id, tenant_id, branch_id, device_id, staff_id, external_user_id, external_event_id, punch_type, punch_at, raw_event_json, suspicious, suspicious_reason, status)
        VALUES (@id, @tenant_id, @branch_id, @device_id, @staff_id, @external_user_id, @external_event_id, @punch_type, @punch_at, @raw_event_json, @suspicious, @suspicious_reason, @status)`).run(log);
      db.prepare("UPDATE staff_attendance_logs SET selfie_url = ?, device_id = ?, source = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(selfieUrl, device.id, evidence.source, now(), attendance.id, access.tenantId);
      staffAudit("staff.camera_attendance_captured", "staff_attendance_camera_evidence", evidence.id, access, { after: { ...evidence, image_data_url: "[stored]" }, branchId });
    })();
    if (suspiciousReasons.length) {
      this.recordRiskEvent({
        branchId,
        staffId: staff.id,
        attendanceId: attendance.id,
        sourceType: evidence.source,
        riskType: "camera_attendance_review",
        severity: suspiciousReasons.includes("biometric consent missing") ? "high" : "medium",
        riskScore: suspiciousReasons.includes("biometric consent missing") ? 85 : 65,
        reason: suspiciousReasons.join(", "),
        evidence: { evidenceId, imageHash, livenessScore: evidence.liveness_score, matchScore: evidence.match_score, edgeVerified },
        referenceId: evidenceId,
        idempotencyKey: `camera-risk:${access.tenantId}:${evidenceId}`
      }, access);
    }
    emitStaffEvent("staff:camera_attendance_captured", access, branchId, evidence.id, { staffId: staff.id, attendanceId: attendance.id, punchType });
    return {
      attendance: camel(db.prepare("SELECT * FROM staff_attendance_logs WHERE id = ? AND tenant_id = ?").get(attendance.id, access.tenantId)),
      evidence: camel({ ...evidence, image_data_url: evidence.image_data_url ? "[stored]" : "" }),
      log: camel(log)
    };
  }

  createMapping(payload = {}, access) {
    access = requireTenant(access);
    requireManager(access);
    const staff = staffById(payload.staffId || payload.staff_id, access);
    const deviceId = payload.deviceId || payload.device_id;
    const device = db.prepare("SELECT * FROM biometric_devices WHERE id = ? AND tenant_id = ?").get(deviceId, access.tenantId);
    if (!device) throw notFound("Biometric device not found");
    assertBranch(access, device.branch_id);
    if (staff.branch_id !== device.branch_id) throw badRequest("Staff and device must belong to the same branch for mapping");
    const row = {
      id: makeId("bio_map"),
      tenant_id: access.tenantId,
      branch_id: device.branch_id,
      device_id: deviceId,
      staff_id: staff.id,
      external_user_id: payload.externalUserId || payload.external_user_id || "",
      mapping_type: payload.mappingType || payload.mapping_type || "device_user",
      status: payload.status || "pending",
      requested_by: access.userId || "",
      notes: payload.notes || ""
    };
    if (!row.external_user_id) throw badRequest("externalUserId is required");
    db.transaction(() => {
      db.prepare(`INSERT INTO biometric_staff_mappings
        (id, tenant_id, branch_id, device_id, staff_id, external_user_id, mapping_type, status, requested_by, notes)
        VALUES (@id, @tenant_id, @branch_id, @device_id, @staff_id, @external_user_id, @mapping_type, @status, @requested_by, @notes)`).run(row);
      staffAudit("staff.biometric_mapping_requested", "biometric_staff_mappings", row.id, access, { after: row, branchId: row.branch_id });
    })();
    return camel(db.prepare("SELECT * FROM biometric_staff_mappings WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  approveMapping(id, payload = {}, access) {
    access = requireTenant(access);
    requireManager(access);
    const row = db.prepare("SELECT * FROM biometric_staff_mappings WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Biometric mapping not found");
    assertBranch(access, row.branch_id);
    if (payload.version !== undefined && Number(payload.version) !== Number(row.version)) throw conflict("Biometric mapping was updated by another request");
    db.transaction(() => {
      db.prepare(`UPDATE biometric_staff_mappings SET status = 'approved', approved_by = ?, approved_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND tenant_id = ?`).run(access.userId || "", now(), now(), id, access.tenantId);
      staffAudit("staff.biometric_mapping_approved", "biometric_staff_mappings", id, access, { before: row, branchId: row.branch_id });
    })();
    emitStaffEvent("staff:biometric_mapping_approved", access, row.branch_id, id);
    return camel(db.prepare("SELECT * FROM biometric_staff_mappings WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
  }

  getGateway(id, access) {
    const row = db.prepare(`SELECT * FROM biometric_gateway_agents
      WHERE tenant_id = ? AND (id = ? OR gateway_code = ?)`).get(access.tenantId, id, id);
    if (!row) throw notFound("Biometric gateway not found");
    assertBranch(access, row.branch_id);
    return row;
  }

  resolveGatewayDevice(event = {}, gateway, access) {
    const deviceId = event.deviceId || event.device_id || "";
    if (deviceId) return this.getDevice(deviceId, access);
    const deviceCode = event.deviceCode || event.device_code || "";
    if (!deviceCode) throw badRequest("deviceId or deviceCode is required for gateway events");
    const row = db.prepare(`SELECT * FROM biometric_devices
      WHERE tenant_id = ? AND branch_id = ? AND device_code = ?`).get(access.tenantId, gateway.branch_id, deviceCode);
    if (!row) throw notFound(`Biometric device not found for gateway code ${deviceCode}`);
    return camel({ ...row, credentials_encrypted: row.credentials_encrypted ? "[encrypted]" : "" });
  }

  hasConsent(staffId, access, consentType = "biometric_attendance") {
    const row = db.prepare(`SELECT * FROM staff_biometric_consents
      WHERE tenant_id = ? AND staff_id = ? AND consent_type = ?`).get(access.tenantId, staffId, consentType);
    return Boolean(row && row.consent_status === "granted" && Number(row.delete_requested || 0) !== 1);
  }

  recordRiskEvent(payload = {}, access) {
    access = requireTenant(access);
    const branchId = branchIdFrom(payload, access);
    if (branchId) assertBranch(access, branchId);
    const idempotencyKey = payload.idempotencyKey || payload.idempotency_key || hashPayload({
      tenantId: access.tenantId,
      branchId,
      staffId: payload.staffId || payload.staff_id || "",
      riskType: payload.riskType || payload.risk_type,
      referenceId: payload.referenceId || payload.reference_id || payload.attendanceId || payload.attendance_id || "",
      reason: payload.reason || ""
    });
    const row = {
      id: makeId("att_risk"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      staff_id: payload.staffId || payload.staff_id || "",
      attendance_id: payload.attendanceId || payload.attendance_id || "",
      source_type: payload.sourceType || payload.source_type || "biometric",
      risk_type: payload.riskType || payload.risk_type || "attendance_risk",
      severity: payload.severity || "medium",
      risk_score: Number(payload.riskScore ?? payload.risk_score ?? 50),
      reason: payload.reason || "",
      evidence_json: toJson(payload.evidence || {}),
      status: payload.status || "open",
      idempotency_key: idempotencyKey,
      created_by: access.userId || ""
    };
    db.prepare(`INSERT OR IGNORE INTO staff_attendance_risk_events
      (id, tenant_id, branch_id, staff_id, attendance_id, source_type, risk_type, severity, risk_score, reason, evidence_json, status, idempotency_key, created_by)
      VALUES (@id, @tenant_id, @branch_id, @staff_id, @attendance_id, @source_type, @risk_type, @severity, @risk_score, @reason, @evidence_json, @status, @idempotency_key, @created_by)`).run(row);
    const stored = db.prepare("SELECT * FROM staff_attendance_risk_events WHERE tenant_id = ? AND idempotency_key = ?").get(access.tenantId, idempotencyKey);
    if (stored?.id === row.id) {
      staffAudit("staff.attendance_risk_detected", "staff_attendance_risk_events", row.id, access, { after: row, branchId });
      emitStaffEvent("staff:attendance_risk_detected", access, branchId, row.id, { severity: row.severity, riskType: row.risk_type });
      this.queueOwnerAlert({
        branchId,
        alertType: "attendance_risk",
        title: "Attendance risk detected",
        body: row.reason || `${row.risk_type} needs review.`,
        severity: row.severity,
        referenceType: "staff_attendance_risk_events",
        referenceId: row.id,
        idempotencyKey: `alert:${idempotencyKey}`
      }, access);
    }
    return stored ? camel(stored) : null;
  }

  queueOwnerAlert(payload = {}, access) {
    access = requireTenant(access);
    const branchId = branchIdFrom(payload, access);
    if (branchId) assertBranch(access, branchId);
    if (!generalSettingsService.ownerNotificationsEnabled(access, branchId)) return null;
    const idempotencyKey = payload.idempotencyKey || payload.idempotency_key || hashPayload({
      tenantId: access.tenantId,
      branchId,
      alertType: payload.alertType || payload.alert_type,
      referenceId: payload.referenceId || payload.reference_id || "",
      title: payload.title || ""
    });
    const row = {
      id: makeId("own_alert"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      alert_type: payload.alertType || payload.alert_type || "owner_alert",
      channel: payload.channel || "whatsapp",
      title: payload.title || "Owner alert",
      body: payload.body || "",
      severity: payload.severity || "info",
      reference_type: payload.referenceType || payload.reference_type || "",
      reference_id: payload.referenceId || payload.reference_id || "",
      metadata_json: toJson(payload.metadata || {}),
      status: payload.status || "queued",
      created_by: access.userId || "",
      idempotency_key: idempotencyKey
    };
    db.prepare(`INSERT OR IGNORE INTO owner_command_alerts
      (id, tenant_id, branch_id, alert_type, channel, title, body, severity, reference_type, reference_id, metadata_json, status, created_by, idempotency_key)
      VALUES (@id, @tenant_id, @branch_id, @alert_type, @channel, @title, @body, @severity, @reference_type, @reference_id, @metadata_json, @status, @created_by, @idempotency_key)`).run(row);
    const stored = db.prepare("SELECT * FROM owner_command_alerts WHERE tenant_id = ? AND idempotency_key = ?").get(access.tenantId, idempotencyKey);
    if (stored?.id === row.id) {
      staffAudit("staff.owner_alert_queued", "owner_command_alerts", row.id, access, { after: row, branchId });
      emitStaffEvent("staff:owner_alert_queued", access, branchId, row.id, { severity: row.severity, alertType: row.alert_type });
    }
    return stored ? camel(stored) : null;
  }

  ensureCameraDevice(branchId, access) {
    const deviceCode = `camera-${branchId}`;
    const existing = db.prepare(`SELECT * FROM biometric_devices
      WHERE tenant_id = ? AND branch_id = ? AND device_code = ?`).get(access.tenantId, branchId, deviceCode);
    if (existing) return camel({ ...existing, credentials_encrypted: existing.credentials_encrypted ? "[encrypted]" : "" });
    const row = {
      id: makeId("bio_dev"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      provider: "camera",
      device_code: deviceCode,
      device_name: "Web camera attendance",
      device_type: "camera",
      location_label: "Front desk / mobile camera",
      connection_mode: "browser_camera",
      credentials_encrypted: "",
      last_health_status: "online",
      last_seen_at: now(),
      status: "active",
      created_by: access.userId || ""
    };
    db.prepare(`INSERT INTO biometric_devices
      (id, tenant_id, branch_id, provider, device_code, device_name, device_type, location_label, connection_mode, credentials_encrypted, last_health_status, last_seen_at, status, created_by)
      VALUES (@id, @tenant_id, @branch_id, @provider, @device_code, @device_name, @device_type, @location_label, @connection_mode, @credentials_encrypted, @last_health_status, @last_seen_at, @status, @created_by)`).run(row);
    return camel(row);
  }

  parsePayload(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  deriveLivenessScore(checks = {}) {
    if (!checks || typeof checks !== "object") return 0;
    const values = [
      checks.blinkScore ?? checks.blink_score,
      checks.motionScore ?? checks.motion_score,
      checks.depthScore ?? checks.depth_score,
      checks.passiveScore ?? checks.passive_score
    ].map(Number).filter((value) => Number.isFinite(value));
    if (!values.length) return 0;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
  }
}

export const staffBiometricService = new StaffBiometricService();
