import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { securityBlocklistService } from "./security-blocklist.service.js";
import { securityService } from "./security.service.js";
import { generalSettingsService } from "./general-settings.service.js";

const ADMIN_ROLES = new Set(["owner", "admin", "superAdmin"]);
const NOTIFY_ROLES = new Set(["owner", "admin", "superAdmin"]);
const VALID_SEVERITIES = new Set(["critical", "warning", "info"]);
const FAILED_LOGIN_WINDOW_MS = 10 * 60 * 1000;
const FAILED_LOGIN_THRESHOLD = 5;
const REQUEST_SPIKE_WINDOW_MS = 60 * 1000;
const REQUEST_SPIKE_THRESHOLD = 120;
const BULK_ACTION_THRESHOLD = 50;

const failedLoginsByIp = new Map();
const requestSpikesByIp = new Map();

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;

function prune(list, windowMs) {
  const cutoff = Date.now() - windowMs;
  return list.filter((item) => item.ts >= cutoff);
}

function toJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return JSON.stringify({ value: String(value) });
  }
}

function fromJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function rowToAlert(row) {
  if (!row) return null;
  return { ...row, details: typeof row.details === "string" ? fromJson(row.details) : row.details || {} };
}

function isOffHoursIst() {
  const date = new Date();
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + 330;
  const hour = Math.floor((minutes % 1440) / 60);
  return hour >= 23 || hour < 6;
}

export class IntrusionDetectionService {
  recordFailedLogin({ tenantId, email, ip, userAgent }) {
    try {
      this.auditEvent({
        tenantId,
        action: "auth.login_failed",
        targetType: "tenant_user",
        severity: "warning",
        ipAddress: ip || "",
        details: { email: String(email || "").toLowerCase(), userAgent }
      });

      const key = ip || "unknown";
      const list = prune(failedLoginsByIp.get(key) || [], FAILED_LOGIN_WINDOW_MS);
      list.push({ tenantId, email: String(email || "").toLowerCase(), userAgent, ts: Date.now() });
      failedLoginsByIp.set(key, list);

      if (list.length < FAILED_LOGIN_THRESHOLD) return null;
      const distinctEmails = [...new Set(list.map((item) => item.email).filter(Boolean))];
      const distinctTenants = [...new Set(list.map((item) => item.tenantId).filter(Boolean))];
      const alert = this.raiseAlert({
        tenantId: tenantId || distinctTenants[0] || "",
        alertType: distinctEmails.length > 1 ? "multiple_account_attack" : "repeated_failed_login",
        severity: "critical",
        ipAddress: ip || "",
        summary: `${list.length} failed login attempts from ${ip || "unknown IP"} in 10 minutes`,
        details: { attempts: list.length, distinctEmails, distinctTenants, userAgent }
      });
      failedLoginsByIp.set(key, []);
      return alert;
    } catch {
      return null;
    }
  }

  checkAdminLogin({ tenantId, userId, role, ip, userAgent, deviceId }) {
    try {
      if (!ADMIN_ROLES.has(role)) return null;
      const priorIp = db.prepare(`
        SELECT id FROM security_audit_logs
        WHERE tenantId = ? AND actorUserId = ? AND ipAddress = ? AND action = 'auth.login'
        LIMIT 1
      `).get(tenantId, userId, ip || "");

      const alerts = [];
      if (!priorIp) {
        alerts.push(this.raiseAlert({
          tenantId,
          alertType: "admin_new_ip_login",
          severity: "warning",
          ipAddress: ip || "",
          userId,
          summary: `${role} account signed in from a new IP (${ip || "unknown"})`,
          details: { role, userAgent, deviceId }
        }));
      }

      if (isOffHoursIst()) {
        alerts.push(this.raiseAlert({
          tenantId,
          alertType: "off_hours_admin_login",
          severity: "info",
          ipAddress: ip || "",
          userId,
          summary: `${role} account signed in outside normal business hours`,
          details: { role, userAgent, deviceId, timezone: "IST" }
        }));
      }
      return alerts.filter(Boolean);
    } catch {
      return null;
    }
  }

  recordIsolationViolation({ tenantId, userId, role, attemptedTenantId, attemptedBranchId, ip, path }) {
    return this.raiseAlert({
      tenantId: tenantId || attemptedTenantId || "",
      alertType: "tenant_isolation_violation",
      severity: "critical",
      ipAddress: ip || "",
      userId: userId || "",
      summary: "Tenant or branch isolation violation attempt detected",
      details: { role, attemptedTenantId, attemptedBranchId, path }
    });
  }

  recordBulkAction({ tenantId, userId, role, action, recordCount, ip }) {
    if (Number(recordCount || 0) < BULK_ACTION_THRESHOLD) return null;
    return this.raiseAlert({
      tenantId,
      alertType: "bulk_data_action",
      severity: "warning",
      ipAddress: ip || "",
      userId: userId || "",
      summary: `${role || "User"} performed ${action || "bulk action"} affecting ${recordCount} records`,
      details: { role, action, recordCount }
    });
  }

  recordSensitiveAccess({ tenantId, userId, role, resource, ip }) {
    return this.raiseAlert({
      tenantId,
      alertType: "sensitive_data_access",
      severity: "info",
      ipAddress: ip || "",
      userId: userId || "",
      summary: `${role || "User"} accessed sensitive resource: ${resource || "unknown"}`,
      details: { role, resource }
    });
  }

  recordRequestSpike({ tenantId, userId, role, ip, path }) {
    try {
      const key = `${tenantId || "public"}:${ip || "unknown"}`;
      const list = prune(requestSpikesByIp.get(key) || [], REQUEST_SPIKE_WINDOW_MS);
      list.push({ path, ts: Date.now() });
      requestSpikesByIp.set(key, list);
      if (list.length < REQUEST_SPIKE_THRESHOLD) return null;
      const alert = this.raiseAlert({
        tenantId,
        alertType: "unusual_request_spike",
        severity: "warning",
        ipAddress: ip || "",
        userId: userId || "",
        summary: `${list.length} requests from ${ip || "unknown IP"} in 60 seconds`,
        details: { role, samplePaths: list.slice(-10).map((item) => item.path) }
      });
      requestSpikesByIp.set(key, []);
      return alert;
    } catch {
      return null;
    }
  }

  raiseAlert({ tenantId, branchId = "", alertType, severity = "warning", ipAddress = "", userId = "", summary, details = {} }) {
    try {
      if (!tenantId || !alertType || !summary) return null;
      const safeSeverity = VALID_SEVERITIES.has(severity) ? severity : "warning";
      const timestamp = now();
      const alert = {
        id: makeId("alert"),
        tenantId,
        branchId,
        alertType,
        severity: safeSeverity,
        ipAddress,
        userId,
        summary,
        details: toJson(details),
        status: "open",
        notifiedAt: "",
        resolvedAt: "",
        createdAt: timestamp,
        updatedAt: timestamp
      };
      db.prepare(`
        INSERT INTO security_alerts
        (id, tenantId, branchId, alertType, severity, ipAddress, userId, summary, details, status, notifiedAt, resolvedAt, createdAt, updatedAt)
        VALUES (@id, @tenantId, @branchId, @alertType, @severity, @ipAddress, @userId, @summary, @details, @status, @notifiedAt, @resolvedAt, @createdAt, @updatedAt)
      `).run(alert);

      this.auditAlert({ ...alert, details });
      const output = rowToAlert(alert);
      this.enqueueOwnerNotifications(output);
      securityBlocklistService.blockIpForAlert(output);
      return output;
    } catch {
      return null;
    }
  }

  auditAlert(alert) {
    try {
      securityService.audit({
        action: `security.alert.${alert.alertType}`,
        targetType: "security_alert",
        targetId: alert.id,
        severity: alert.severity,
        details: alert.details
      }, {
        tenantId: alert.tenantId,
        branchId: alert.branchId || "",
        userId: alert.userId || "",
        role: "system",
        branchIds: alert.branchId ? [alert.branchId] : []
      }, { ip: alert.ipAddress || "", get: () => "" });
    } catch {
      // Alert audit should never break the original request.
    }
  }

  auditEvent({ tenantId, branchId = "", userId = "", action, targetType = "", targetId = "", severity = "info", ipAddress = "", details = {} }) {
    try {
      if (!tenantId || !action) return;
      securityService.audit({
        action,
        targetType,
        targetId,
        severity,
        details
      }, {
        tenantId,
        branchId,
        userId,
        role: "system",
        branchIds: branchId ? [branchId] : []
      }, { ip: ipAddress || "", get: (header) => (header === "user-agent" ? details.userAgent || "" : "") });
    } catch {
      // Audit failures should never break the original security signal.
    }
  }

  enqueueOwnerNotifications(alert) {
    try {
      if (!alert || !["critical", "warning"].includes(alert.severity)) return;
      const policyAccess = { tenantId: alert.tenantId, branchId: alert.branchId || "", branchIds: alert.branchId ? [alert.branchId] : [], role: "system" };
      if (!generalSettingsService.ownerNotificationsEnabled(policyAccess, alert.branchId || "")) return;
      const users = repositories.tenantUsers
        .list({ limit: 1000 }, { tenantId: alert.tenantId })
        .filter((user) => NOTIFY_ROLES.has(user.role) && user.status !== "inactive");
      const timestamp = now();
      const title = alert.severity === "critical" ? "Critical Security Alert" : "Security Warning";

      for (const user of users) {
        repositories.pushNotifications.create({
          id: makeId("push"),
          userId: user.id,
          branchId: alert.branchId || "",
          deviceId: "",
          title,
          message: alert.summary,
          payload: {
            type: "security_alert",
            alertId: alert.id,
            alertType: alert.alertType,
            severity: alert.severity,
            ipAddress: alert.ipAddress || "",
            userId: alert.userId || "",
            timestamp
          },
          status: "queued",
          providerMessageId: "",
          sentAt: ""
        }, { tenantId: alert.tenantId });
      }

      if (users.length) {
        db.prepare("UPDATE security_alerts SET notifiedAt = ?, updatedAt = ? WHERE id = ? AND tenantId = ?")
          .run(timestamp, timestamp, alert.id, alert.tenantId);
      }
    } catch {
      // Notification queue failures should never break the original request.
    }
  }

  listAlerts(query = {}, access = {}) {
    const limit = Math.min(Number(query.limit || 100), 500);
    const status = String(query.status || "").trim();
    const severity = String(query.severity || "").trim();
    const params = [access.tenantId];
    const where = ["tenantId = ?"];
    if (access.branchId) {
      where.push("(branchId = '' OR branchId = ?)");
      params.push(access.branchId);
    }
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (severity) {
      where.push("severity = ?");
      params.push(severity);
    }
    params.push(limit);
    return db.prepare(`
      SELECT * FROM security_alerts
      WHERE ${where.join(" AND ")}
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(...params).map(rowToAlert);
  }

  summary(access = {}) {
    const params = [access.tenantId];
    const branchWhere = access.branchId ? "AND (branchId = '' OR branchId = ?)" : "";
    if (access.branchId) params.push(access.branchId);
    const rows = db.prepare(`
      SELECT severity, status, COUNT(*) count
      FROM security_alerts
      WHERE tenantId = ? ${branchWhere}
      GROUP BY severity, status
    `).all(...params);
    const result = { open: 0, resolved: 0, critical: 0, warning: 0, info: 0 };
    for (const row of rows) {
      const count = Number(row.count || 0);
      if (row.status === "open") result.open += count;
      if (row.status === "resolved") result.resolved += count;
      if (row.status === "open" && result[row.severity] !== undefined) result[row.severity] += count;
    }
    return result;
  }

  resolveAlert(id, access = {}) {
    const timestamp = now();
    const result = db.prepare(`
      UPDATE security_alerts
      SET status = 'resolved', resolvedAt = ?, updatedAt = ?
      WHERE id = ? AND tenantId = ?
    `).run(timestamp, timestamp, id, access.tenantId);
    if (result.changes > 0) {
      this.auditEvent({
        tenantId: access.tenantId,
        branchId: access.branchId || "",
        userId: access.userId || "",
        action: "security.alert.resolved",
        targetType: "security_alert",
        targetId: id,
        severity: "info",
        details: { resolvedBy: access.userId || "" }
      });
    }
    return { id, resolved: result.changes > 0 };
  }
}

export const intrusionDetectionService = new IntrusionDetectionService();
