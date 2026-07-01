import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { join } from "node:path";
import { dataDir, db, dbPath } from "../db.js";
import { env } from "../config/env.js";
import { repositories } from "../repositories/repository-registry.js";
import { builtinRoles, can, staticGrantsForRole } from "../middleware/rbac.js";
import { badRequest, forbidden, notFound } from "../utils/app-error.js";
import { tenantService } from "./tenant.service.js";
import { permissionResources, staffPermissionCatalog } from "../config/staff-permission-catalog.js";

const backupDir = join(dataDir, "backups");
const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const ownerControlRoles = new Set(["owner", "admin", "superAdmin"]);
const tenantUserStatuses = new Set(["active", "hidden", "disabled", "suspended"]);


function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {});
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function key() {
  return scryptSync(env.encryptionSecret || env.jwtSecret, "aura-salon-security", 32);
}

function passwordHashFor(password, salt) {
  return scryptSync(String(password || ""), salt, 64).toString("hex");
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeBranchIds(value) {
  if (Array.isArray(value)) return safeJsonArray(value);
  return String(value || "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function publicTenantUser(row, sessionsByUser = {}, activityByUser = {}) {
  const branchIds = safeJsonArray(row.branchIds);
  const locked = Boolean(row.lockedUntil && row.lockedUntil > now());
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    loginId: row.loginId || "",
    email: row.email,
    role: row.role,
    branchIds,
    branchCount: branchIds.length,
    staffId: row.staffId || "",
    failedLoginCount: Number(row.failedLoginCount || 0),
    lockedUntil: row.lockedUntil || "",
    isLocked: locked,
    status: row.status || "active",
    lastLoginAt: row.lastLoginAt || "",
    activeSessions: sessionsByUser[row.id] || 0,
    lastActivityAt: activityByUser[row.id] || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function assertOwnerControl(access) {
  if (!ownerControlRoles.has(access?.role || "")) {
    throw forbidden("Only owner, admin or super admin can manage users and roles");
  }
}

export class SecurityService {
  summary(_query = {}, access) {
    const queryScope = scope(access);
    const auditLogs = repositories.securityAuditLogs.list({ limit: 100 }, queryScope);
    const activities = repositories.securityActivityEvents.list({ limit: 100 }, queryScope);
    const sessions = repositories.securitySessions.list({ limit: 100 }, queryScope);
    const backups = repositories.securityBackups.list({ limit: 50 }, queryScope);
    const permissions = repositories.securityPermissions.list({ limit: 1000 }, queryScope);
    const secrets = repositories.encryptedSecrets.list({ limit: 100 }, queryScope).map((item) => ({
      id: item.id,
      name: item.name,
      purpose: item.purpose,
      status: item.status,
      createdAt: item.createdAt
    }));
    const lastHour = Date.now() - 60 * 60 * 1000;
    const recentActivity = activities.filter((item) => new Date(item.createdAt).getTime() >= lastHour);
    const denied = auditLogs.filter((item) => item.severity === "warning" || item.action.includes("denied"));
    return {
      metrics: {
        auditLogs: auditLogs.length,
        activeSessions: sessions.filter((item) => item.status === "active" && !item.revokedAt).length,
        backups: backups.length,
        permissions: permissions.length,
        encryptedSecrets: secrets.length,
        recentRequests: recentActivity.length,
        deniedEvents: denied.length,
        riskScore: Math.min(100, denied.length * 10 + Math.max(0, recentActivity.length - 60))
      },
      auditLogs,
      activities,
      sessions,
      backups,
      permissions,
      secrets,
      controls: {
        rateLimiting: "enabled",
        apiProtection: "security headers + request tracking",
        auditLogs: "persisted",
        encryption: "aes-256-gcm",
        backups: "sqlite file snapshots"
      }
    };
  }

  permissionMatrix(access) {
    const roleDefinitions = repositories.roleDefinitions.list({ limit: 1000 }, scope(access));
    const permissionRows = repositories.securityPermissions.list({ limit: 5000 }, scope(access));
    const roles = [...new Set([...builtinRoles(), ...roleDefinitions.map((item) => item.role), ...permissionRows.map((item) => item.role)])].sort();
    const actions = ["read", "write", "admin"];
    return {
      roles: roles.map((role) => ({
        role,
        name: roleDefinitions.find((item) => item.role === role)?.name || role,
        description: roleDefinitions.find((item) => item.role === role)?.description || "",
        isSystem: roleDefinitions.find((item) => item.role === role)?.isSystem ?? (builtinRoles().includes(role) ? 1 : 0),
        staticGrants: staticGrantsForRole(role)
      })),
      resources: permissionResources,
      permissionCatalog: staffPermissionCatalog,
      actions,
      matrix: roles.map((role) => ({
        role,
        resources: Object.fromEntries(
          permissionResources.map((resource) => [
            resource,
            Object.fromEntries(actions.map((action) => [action, can(role, action, resource, access)]))
          ])
        )
      })),
      permissionRows,
      customRoles: roleDefinitions.filter((item) => !Number(item.isSystem))
    };
  }

  userManagement(access) {
    const base = this.permissionMatrix(access);
    const userRows = db.prepare(
      `SELECT id, tenantId, name, loginId, email, role, branchIds, staffId,
              failedLoginCount, lockedUntil, lastLoginAt, status, createdAt, updatedAt
         FROM tenant_users
        WHERE tenantId = @tenantId
        ORDER BY CASE WHEN role IN ('owner', 'superAdmin', 'admin') THEN 0 ELSE 1 END, name COLLATE NOCASE`
    ).all({ tenantId: access.tenantId });
    const sessions = repositories.securitySessions.list({ limit: 5000 }, scope(access));
    const activities = repositories.securityActivityEvents.list({ limit: 5000 }, scope(access));
    const sessionsByUser = sessions.reduce((acc, item) => {
      if (item.status === "active" && !item.revokedAt) acc[item.userId] = (acc[item.userId] || 0) + 1;
      return acc;
    }, {});
    const activityByUser = activities.reduce((acc, item) => {
      if (!item.userId) return acc;
      if (!acc[item.userId] || item.createdAt > acc[item.userId]) acc[item.userId] = item.createdAt;
      return acc;
    }, {});
    const users = userRows.map((row) => publicTenantUser(row, sessionsByUser, activityByUser));
    return {
      ...base,
      users,
      metrics: {
        users: users.length,
        activeUsers: users.filter((item) => item.status === "active").length,
        ownerUsers: users.filter((item) => ownerControlRoles.has(item.role)).length,
        lockedUsers: users.filter((item) => item.isLocked).length,
        customRoles: base.customRoles.length,
        resources: base.resources.length
      },
      activity: activities.slice(0, 40),
      sessions: sessions.slice(0, 40)
    };
  }

  createTenantUser(payload = {}, access, req = null) {
    assertOwnerControl(access);
    const name = String(payload.name || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    const role = String(payload.role || "").trim();
    const password = String(payload.password || payload.tempPassword || "").trim();
    if (!name || !email || !role || !password) throw badRequest("name, email, role and temporary password are required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Valid email is required");
    if (password.length < 10) throw badRequest("Temporary password must be at least 10 characters");
    this.assertRoleExists(role, access);
    const duplicate = db.prepare(
      `SELECT id FROM tenant_users
        WHERE tenantId = @tenantId
          AND (lower(email) = lower(@email) OR (@loginId <> '' AND lower(loginId) = lower(@loginId)))`
    ).get({ tenantId: access.tenantId, email, loginId: String(payload.loginId || "").trim() });
    if (duplicate) throw badRequest("A user with this email or login ID already exists");
    const stamp = now();
    const salt = randomBytes(16).toString("base64url");
    const user = {
      id: makeId("tuser"),
      tenantId: access.tenantId,
      name,
      loginId: String(payload.loginId || "").trim(),
      email,
      role,
      branchIds: JSON.stringify(normalizeBranchIds(payload.branchIds || payload.branchIdsText)),
      staffId: String(payload.staffId || "").trim(),
      passwordSalt: salt,
      passwordHash: passwordHashFor(password, salt),
      failedLoginCount: 0,
      lockedUntil: "",
      lastLoginAt: "",
      status: tenantUserStatuses.has(payload.status) ? payload.status : "active",
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(
      `INSERT INTO tenant_users (
        id, tenantId, name, loginId, email, role, branchIds, staffId,
        passwordSalt, passwordHash, failedLoginCount, lockedUntil, lastLoginAt, status, createdAt, updatedAt
      ) VALUES (
        @id, @tenantId, @name, @loginId, @email, @role, @branchIds, @staffId,
        @passwordSalt, @passwordHash, @failedLoginCount, @lockedUntil, @lastLoginAt, @status, @createdAt, @updatedAt
      )`
    ).run(user);
    this.audit({ action: "tenant_user.created", targetType: "tenant_user", targetId: user.id, details: { name, email, role, branchIds: safeJsonArray(user.branchIds), status: user.status } }, access, req);
    return { user: publicTenantUser(user), management: this.userManagement(access) };
  }

  updateTenantUser(userId, payload = {}, access, req = null) {
    assertOwnerControl(access);
    if (!userId) throw badRequest("userId is required");
    const existing = db.prepare(
      `SELECT id, tenantId, name, loginId, email, role, branchIds, staffId,
              passwordSalt, passwordHash, failedLoginCount, lockedUntil, lastLoginAt, status, createdAt, updatedAt
         FROM tenant_users
        WHERE tenantId = @tenantId AND id = @id`
    ).get({ tenantId: access.tenantId, id: userId });
    if (!existing) throw notFound("User not found");
    const next = {
      id: existing.id,
      tenantId: existing.tenantId,
      name: payload.name === undefined ? existing.name : String(payload.name || "").trim(),
      loginId: payload.loginId === undefined ? existing.loginId || "" : String(payload.loginId || "").trim(),
      email: payload.email === undefined ? existing.email : String(payload.email || "").trim().toLowerCase(),
      role: payload.role === undefined ? existing.role : String(payload.role || "").trim(),
      branchIds: payload.branchIds === undefined && payload.branchIdsText === undefined ? existing.branchIds : JSON.stringify(normalizeBranchIds(payload.branchIds || payload.branchIdsText)),
      staffId: payload.staffId === undefined ? existing.staffId || "" : String(payload.staffId || "").trim(),
      passwordSalt: existing.passwordSalt || "",
      passwordHash: existing.passwordHash || "",
      failedLoginCount: payload.resetFailedLoginCount ? 0 : Number(existing.failedLoginCount || 0),
      lockedUntil: payload.unlock ? "" : existing.lockedUntil || "",
      lastLoginAt: existing.lastLoginAt || "",
      status: payload.status === undefined ? existing.status || "active" : String(payload.status || "active").trim(),
      createdAt: existing.createdAt,
      updatedAt: now()
    };
    if (!next.name || !next.email || !next.role) throw badRequest("name, email and role are required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw badRequest("Valid email is required");
    if (!tenantUserStatuses.has(next.status)) throw badRequest("Invalid user status");
    this.assertRoleExists(next.role, access);
    const duplicate = db.prepare(
      `SELECT id FROM tenant_users
        WHERE tenantId = @tenantId
          AND id <> @id
          AND (lower(email) = lower(@email) OR (@loginId <> '' AND lower(loginId) = lower(@loginId)))`
    ).get({ tenantId: access.tenantId, id: userId, email: next.email, loginId: next.loginId });
    if (duplicate) throw badRequest("A user with this email or login ID already exists");
    if (payload.lockMinutes || payload.lockedUntil) {
      const lockMinutes = Number(payload.lockMinutes || 15);
      next.lockedUntil = payload.lockedUntil || new Date(Date.now() + Math.max(1, lockMinutes) * 60000).toISOString();
    }
    const newPassword = String(payload.password || payload.tempPassword || "").trim();
    if (newPassword) {
      if (newPassword.length < 10) throw badRequest("Temporary password must be at least 10 characters");
      next.passwordSalt = randomBytes(16).toString("base64url");
      next.passwordHash = passwordHashFor(newPassword, next.passwordSalt);
      next.failedLoginCount = 0;
      next.lockedUntil = "";
    }
    this.assertNotLastOwner(existing, next, access);
    db.prepare(
      `UPDATE tenant_users
          SET name = @name,
              loginId = @loginId,
              email = @email,
              role = @role,
              branchIds = @branchIds,
              staffId = @staffId,
              passwordSalt = @passwordSalt,
              passwordHash = @passwordHash,
              failedLoginCount = @failedLoginCount,
              lockedUntil = @lockedUntil,
              lastLoginAt = @lastLoginAt,
              status = @status,
              updatedAt = @updatedAt
        WHERE tenantId = @tenantId AND id = @id`
    ).run(next);
    this.audit({
      action: "tenant_user.updated",
      targetType: "tenant_user",
      targetId: userId,
      details: { name: next.name, email: next.email, role: next.role, branchIds: safeJsonArray(next.branchIds), status: next.status, lockedUntil: next.lockedUntil, passwordReset: Boolean(newPassword) }
    }, access, req);
    return { user: publicTenantUser(next), management: this.userManagement(access) };
  }

  disableTenantUser(userId, access, req = null) {
    return this.updateTenantUser(userId, { status: "disabled", unlock: true }, access, req);
  }

  assertRoleExists(role, access) {
    const found = builtinRoles().includes(role) || Boolean(db.prepare("SELECT id FROM role_definitions WHERE tenantId = @tenantId AND role = @role").get({ tenantId: access.tenantId, role }));
    if (!found) throw badRequest("Role does not exist");
  }

  assertNotLastOwner(existing, next, access) {
    const wasOwner = ownerControlRoles.has(existing.role);
    const willRemainActiveOwner = ownerControlRoles.has(next.role) && next.status === "active" && !(next.lockedUntil && next.lockedUntil > now());
    if (!wasOwner || willRemainActiveOwner) return;
    const activeOwners = db.prepare(
      `SELECT COUNT(*) AS total
         FROM tenant_users
        WHERE tenantId = @tenantId
          AND id <> @id
          AND role IN ('owner', 'admin', 'superAdmin')
          AND status = 'active'
          AND (lockedUntil = '' OR lockedUntil <= @stamp)`
    ).get({ tenantId: access.tenantId, id: existing.id, stamp: now() });
    if (Number(activeOwners?.total || 0) === 0) throw badRequest("At least one active owner/admin must remain");
  }

  upsertRoleDefinition(payload = {}, access, req = null) {
    if (!payload.role || !payload.name) throw badRequest("role and name are required");
    const role = String(payload.role).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{2,40}$/.test(role)) {
      throw badRequest("role must start with a letter and use letters, numbers, _ or -");
    }
    const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
    if (!permissions.length) throw badRequest("permissions array is required");
    const existing = db.prepare("SELECT id FROM role_definitions WHERE tenantId = ? AND role = ?").get(access.tenantId, role);
    const data = {
      role,
      name: payload.name,
      description: payload.description || "",
      permissions,
      isSystem: payload.isSystem ? 1 : 0,
      status: payload.status || "active",
      createdBy: access.userId || ""
    };
    const definition = existing
      ? repositories.roleDefinitions.update(existing.id, data, scope(access))
      : repositories.roleDefinitions.create({ id: makeId("role"), ...data }, scope(access));

    permissions.forEach((permission) => {
      if (!permission.resource || !Array.isArray(permission.actions)) return;
      if (!permission.actions.length && permission.effect !== "deny") return;
      const found = db.prepare("SELECT id FROM security_permissions WHERE tenantId = @tenantId AND role = @role AND resource = @resource").get({ tenantId: access.tenantId, role, resource: permission.resource });
      const permissionData = {
        role,
        resource: permission.resource,
        actions: permission.actions,
        effect: permission.effect || "allow",
        conditions: permission.conditions || {},
        status: permission.status || "active"
      };
      if (found?.id) {
        repositories.securityPermissions.update(found.id, permissionData, scope(access));
      } else {
        repositories.securityPermissions.create({ id: makeId("perm"), ...permissionData }, scope(access));
      }
    });

    this.audit({ action: "role.upserted", targetType: "role_definition", targetId: definition.id, details: data }, access, req);
    return { definition, matrix: this.permissionMatrix(access) };
  }

  complianceSummary(query = {}, access) {
    const queryScope = scope(access, query.branchId || "");
    const auditLogs = repositories.securityAuditLogs.list({ limit: Number(query.limit || 500) }, queryScope);
    const sessions = repositories.securitySessions.list({ limit: 500 }, queryScope);
    const activities = repositories.securityActivityEvents.list({ limit: 500 }, queryScope);
    const buckets = {
      bookingCreates: auditLogs.filter((item) => item.action === "booking.created"),
      billEdits: auditLogs.filter((item) => item.action === "bill.edited"),
      clientDeletes: auditLogs.filter((item) => item.action === "client.deleted"),
      paymentChanges: auditLogs.filter((item) => item.action.startsWith("payment.") || item.action === "refund.processed"),
      discountApprovals: auditLogs.filter((item) => item.action === "discount.approved"),
      loginHistory: auditLogs.filter((item) => item.action === "auth.login")
    };
    return {
      metrics: {
        trackedEvents: auditLogs.length,
        bookingCreates: buckets.bookingCreates.length,
        billEdits: buckets.billEdits.length,
        clientDeletes: buckets.clientDeletes.length,
        paymentChanges: buckets.paymentChanges.length,
        discountApprovals: buckets.discountApprovals.length,
        logins: buckets.loginHistory.length,
        failedRequests: activities.filter((item) => Number(item.statusCode || 0) >= 400).length
      },
      buckets,
      auditLogs,
      sessions,
      activities
    };
  }

  audit({ action, targetType = "", targetId = "", details = {}, severity = "info" } = {}, access, req = null) {
    if (!action) throw badRequest("action is required");
    return repositories.securityAuditLogs.create({
      id: makeId("audit"),
      branchId: access?.branchId || "",
      actorUserId: access?.userId || "",
      actorRole: access?.role || "",
      action,
      targetType,
      targetId,
      severity,
      ipAddress: req?.ip || "",
      userAgent: req?.get?.("user-agent") || "",
      details,
      createdAt: now()
    }, scope(access));
  }

  auditTrail(query = {}, access) {
    const action = query.action || "";
    const targetType = query.targetType || query.entityType || "";
    const targetId = query.targetId || query.entityId || "";
    const limit = Math.min(Number(query.limit || 100), 500);
    const rows = db.prepare(
      `SELECT * FROM security_audit_logs
       WHERE tenantId = ?
         AND (? = '' OR action = ?)
         AND (? = '' OR targetType = ?)
         AND (? = '' OR targetId = ?)
       ORDER BY createdAt DESC
       LIMIT ?`
    ).all(access.tenantId, action, action, targetType, targetType, targetId, targetId, limit);
    return rows.map((row) => {
      try {
        return { ...row, details: row.details ? JSON.parse(row.details) : {} };
      } catch {
        return { ...row, details: {} };
      }
    });
  }

  recordActivity(req, statusCode, durationMs) {
    try {
      const access = req.access || {};
      if (!access.tenantId || req.originalUrl?.includes("/api/health") || req.originalUrl?.includes("/api/versions")) return;
      repositories.securityActivityEvents.create({
        id: makeId("act"),
        branchId: access.branchId || "",
        userId: access.userId || "",
        role: access.role || "",
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode,
        durationMs,
        ipAddress: req.ip || "",
        userAgent: req.get?.("user-agent") || "",
        metadata: {
          requestId: req.requestId,
          contentLength: Number(req.get?.("content-length") || 0)
        },
        createdAt: now()
      }, scope(access));
    } catch {
      // Activity tracking must never block a business request.
    }
  }

  createSession(payload = {}, access, req = null) {
    if (!payload.userId && !access.userId) throw badRequest("userId is required");
    const session = repositories.securitySessions.create({
      id: makeId("sess"),
      userId: payload.userId || access.userId,
      role: payload.role || access.role,
      branchId: payload.branchId || access.branchId || "",
      deviceId: payload.deviceId || access.deviceId || "",
      ipAddress: payload.ipAddress || req?.ip || "",
      userAgent: payload.userAgent || req?.get?.("user-agent") || "",
      startedAt: now(),
      lastSeenAt: now(),
      expiresAt: payload.expiresAt || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      metadata: payload.metadata || {},
      status: "active"
    }, scope(access));
    this.audit({ action: "session.created", targetType: "security_session", targetId: session.id }, access, req);
    return session;
  }

  revokeSession(id, access, req = null) {
    const session = repositories.securitySessions.getById(id, scope(access));
    if (!session) throw notFound("Session not found");
    const updated = repositories.securitySessions.update(id, {
      status: "revoked",
      revokedAt: now()
    }, scope(access));
    this.audit({ action: "session.revoked", targetType: "security_session", targetId: id, severity: "warning" }, access, req);
    return updated;
  }

  upsertPermission(payload = {}, access, req = null) {
    if (!payload.role || !payload.resource) throw badRequest("role and resource are required");
    const existing = db.prepare("SELECT id FROM security_permissions WHERE tenantId = @tenantId AND role = @role AND resource = @resource").get({ tenantId: access.tenantId, role: payload.role, resource: payload.resource });
    const data = {
      role: payload.role,
      resource: payload.resource,
      actions: payload.actions || ["read"],
      effect: payload.effect || "allow",
      conditions: payload.conditions || {},
      status: payload.status || "active"
    };
    const permission = existing
      ? repositories.securityPermissions.update(existing.id, data, scope(access))
      : repositories.securityPermissions.create({ id: makeId("perm"), ...data }, scope(access));
    this.audit({ action: "permission.upserted", targetType: "security_permission", targetId: permission.id, details: data }, access, req);
    return permission;
  }

  encryptSecret(payload = {}, access, req = null) {
    if (!payload.name || !payload.value) throw badRequest("name and value are required");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const ciphertext = Buffer.concat([cipher.update(String(payload.value), "utf8"), cipher.final()]);
    const secret = repositories.encryptedSecrets.create({
      id: makeId("secret"),
      branchId: payload.branchId || "",
      name: payload.name,
      purpose: payload.purpose || "",
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      metadata: payload.metadata || {},
      status: "active"
    }, scope(access, payload.branchId || ""));
    this.audit({ action: "secret.encrypted", targetType: "encrypted_secret", targetId: secret.id }, access, req);
    return { id: secret.id, name: secret.name, purpose: secret.purpose, status: secret.status, createdAt: secret.createdAt };
  }

  createBackup(payload = {}, access, req = null) {
    mkdirSync(backupDir, { recursive: true });
    const source = dbPath;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tenantSlug = String(access.tenantId || "tenant").replace(/[^a-z0-9_-]/gi, "-");
    const filePath = join(backupDir, `${tenantSlug}-${stamp}.sqlite`);
    copyFileSync(source, filePath);
    const bytes = readFileSync(filePath);
    const stat = statSync(filePath);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const backup = repositories.securityBackups.create({
      id: makeId("backup"),
      branchId: payload.branchId || "",
      type: payload.type || "sqlite-snapshot",
      filePath,
      fileSizeBytes: stat.size,
      checksum,
      manifest: {
        tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name),
        requestedBy: access.userId || "",
        reason: payload.reason || "manual"
      },
      result: { copied: true, checksum },
      status: "completed",
      createdBy: access.userId || ""
    }, scope(access, payload.branchId || ""));
    this.audit({ action: "backup.created", targetType: "security_backup", targetId: backup.id, details: { checksum } }, access, req);
    return backup;
  }

  activityByUser(userId, access) {
    if (!userId) throw badRequest("userId is required");
    return repositories.securityActivityEvents.list({ limit: 250 }, scope(access)).filter((item) => item.userId === userId);
  }
}

export const securityService = new SecurityService();

