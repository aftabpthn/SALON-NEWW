import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { repositories } from "../repositories/repository-registry.js";
import { can, staticGrantsForRole } from "../middleware/rbac.js";
import { AppError, badRequest, forbidden, unauthorized } from "../utils/app-error.js";
import { tenantService } from "./tenant.service.js";
import { assertLoginBranchScope, ensureTenantUserAccessColumns, normalizeRole } from "./access-control.service.js";
import { twoFactorService } from "./two-factor.service.js";
import { intrusionDetectionService } from "./intrusion-detection.service.js";
import { permissionResources } from "../config/staff-permission-catalog.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(value) {
  return createHmac("sha256", env.jwtSecret).update(value).digest("base64url");
}

function hashToken(token) {
  return createHmac("sha256", env.jwtSecret).update(token).digest("hex");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function passwordHashFor(password, salt) {
  return scryptSync(String(password || ""), salt, 64).toString("hex");
}

function addSeconds(seconds) {
  return new Date(Date.now() + Number(seconds) * 1000).toISOString();
}

function addDays(days) {
  return new Date(Date.now() + Number(days) * 86400000).toISOString();
}

function recoveryCodesFor(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeActions(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function addResourceGrant(grants, resource, grant) {
  if (!resource) return;
  if (resource === "*") {
    grants.add(`${grant}:*`);
    return;
  }
  grants.add(`${grant}:${resource}`);
}

function applyActionGrant(grants, resource, action) {
  const normalized = String(action || "").trim().toLowerCase();
  if (!normalized) return;
  if (normalized === "*" || normalized === "all" || normalized === "admin") {
    addResourceGrant(grants, resource, "read");
    addResourceGrant(grants, resource, "write");
    addResourceGrant(grants, resource, "admin");
    return;
  }
  if (["read", "access", "back", "print", "export"].includes(normalized)) {
    addResourceGrant(grants, resource, "read");
    return;
  }
  if (["write", "add", "edit", "delete", "create", "update", "remove"].includes(normalized)) {
    addResourceGrant(grants, resource, "read");
    addResourceGrant(grants, resource, "write");
  }
}

export class AuthService {
  login(payload = {}, request = {}) {
    ensureTenantUserAccessColumns();
    const tenant = tenantService.resolveTenant({ tenantId: payload.tenantId || request.tenantId || "", host: request.host || "" });
    if (!tenant) throw badRequest("Tenant not found");
    tenantService.ensureSubscriptionActive(tenant.id);
    const users = repositories.tenantUsers.list({ limit: 10000 }, { tenantId: tenant.id });
    const userId = String(payload.userId || "").trim();
    const emailIdentity = String(payload.email || "").trim().toLowerCase();
    const loginIdIdentity = String(payload.loginId || "").trim().toLowerCase().replace(/\s+/g, "");
    const loginIdentity = emailIdentity || loginIdIdentity || userId;
    let user = userId ? users.find((item) => item.id === userId) : null;
    if (!user && emailIdentity) {
      user = users.find((item) => String(item.email || "").toLowerCase() === emailIdentity);
    }
    if (!user && loginIdIdentity) {
      user = users.find((item) => String(item.loginId || "").toLowerCase().replace(/\s+/g, "") === loginIdIdentity);
    }
    if (!user) {
      intrusionDetectionService.recordFailedLogin({ tenantId: tenant.id, email: loginIdentity, ip: request.ip || "", userAgent: request.userAgent || "" });
      throw unauthorized("Invalid login credentials");
    }
    user = { ...user, role: normalizeRole(user.role) };
    if (user.status && user.status !== "active") throw forbidden("User is not active");
    if (user.lockedUntil && user.lockedUntil > now()) throw forbidden("User is temporarily locked after repeated failed logins");
    this.verifyPassword(user, payload.password, { tenantId: tenant.id, ip: request.ip || "", userAgent: request.userAgent || "" });
    this.verifyTwoFactor(user, payload, tenant.id);
    const branchId = assertLoginBranchScope(user, payload.branchId || "");
    if (branchId) tenantService.assertBranchAccess({ tenantId: tenant.id, role: user.role, branchIds: user.branchIds || [], branchId }, branchId);
    const device = payload.device ? this.registerDevice({ ...payload.device, userId: user.id, branchId }, { tenantId: tenant.id, userId: user.id, role: user.role, branchId, branchIds: user.branchIds || [] }) : null;
    repositories.tenantUsers.update(user.id, { failedLoginCount: 0, lockedUntil: "", lastLoginAt: now() }, { tenantId: tenant.id });
    return this.issueTokenPair({ tenant, user: { ...user, failedLoginCount: 0, lockedUntil: "", lastLoginAt: now() }, branchId, deviceId: device?.id || payload.deviceId || "" });
  }

  verifyPassword(user, password, context = {}) {
    const requiresPassword = env.requirePasswordAuth || Boolean(user.passwordHash);
    if (!requiresPassword) return true;
    const valid = Boolean(password) && Boolean(user.passwordHash) && Boolean(user.passwordSalt) && safeEqual(passwordHashFor(password, user.passwordSalt), user.passwordHash);
    if (valid) return true;
    const failedLoginCount = Number(user.failedLoginCount || 0) + 1;
    const lockedUntil = failedLoginCount >= 5 ? addSeconds(15 * 60) : user.lockedUntil || "";
    repositories.tenantUsers.update(user.id, { failedLoginCount, lockedUntil }, { tenantId: user.tenantId });
    intrusionDetectionService.recordFailedLogin({ tenantId: context.tenantId || user.tenantId, email: user.email || user.loginId || "", ip: context.ip || "", userAgent: context.userAgent || "" });
    throw unauthorized("Invalid login credentials");
  }

  verifyTwoFactor(user, payload = {}, tenantId) {
    if (!user.totpEnabled) return true;
    const code = String(payload.totpToken || payload.twoFactorCode || "").trim();
    if (!code) throw new AppError("Two-factor authentication code required", 401, { requiresTotp: true });

    const recoveryCodes = recoveryCodesFor(user.totpRecoveryCodes);
    const normalizedRecovery = code.toUpperCase();
    const isRecovery = recoveryCodes.includes(normalizedRecovery);
    const isValidTotp = twoFactorService.verifyToken({ secret: user.totpSecret, token: code });
    if (!isValidTotp && !isRecovery) throw unauthorized("Invalid two-factor authentication code");

    if (isRecovery) {
      repositories.tenantUsers.update(user.id, {
        totpRecoveryCodes: JSON.stringify(recoveryCodes.filter((item) => item !== normalizedRecovery))
      }, { tenantId });
    }
    return true;
  }

  refresh(refreshToken, { fromCookie = false } = {}) {
    ensureTenantUserAccessColumns();
    if (!refreshToken) throw unauthorized("Refresh token is required");
    const tokenHash = hashToken(refreshToken);
    const record = repositories.authRefreshTokens.list({ limit: 100000 }, {}).find((item) => item.tokenHash === tokenHash);
    if (!record || record.revokedAt || record.expiresAt <= now()) throw unauthorized("Refresh token is invalid or expired");
    const tenant = repositories.tenants.getById(record.tenantId);
    const user = repositories.tenantUsers.getById(record.userId, { tenantId: record.tenantId });
    if (!tenant || !user) throw unauthorized("Refresh token account no longer exists");
    if (user.staffId && !fromCookie) throw unauthorized("Staff refresh requires the secure session cookie");
    repositories.authRefreshTokens.update(record.id, { revokedAt: now() }, { tenantId: record.tenantId });
    const branchId = assertLoginBranchScope({ ...user, role: normalizeRole(user.role) }, record.branchId || "");
    return this.issueTokenPair({ tenant, user: { ...user, role: normalizeRole(user.role) }, branchId, deviceId: record.deviceId || "" });
  }

  logout(refreshToken, access = {}) {
    if (!refreshToken) return { revoked: false };
    const tokenHash = hashToken(refreshToken);
    const record = repositories.authRefreshTokens.list({ limit: 10000 }, { tenantId: access.tenantId }).find((item) => item.tokenHash === tokenHash);
    if (!record) return { revoked: false };
    repositories.authRefreshTokens.update(record.id, { revokedAt: now() }, { tenantId: record.tenantId });
    return { revoked: true };
  }

  permissionsForUser(user, tenantId) {
    const role = normalizeRole(user.role || "");
    const staticGrants = staticGrantsForRole(role);
    if (staticGrants.includes("*")) return ["*"];
    const permissionRows = repositories.securityPermissions.list({ limit: 5000 }, { tenantId })
      .filter((row) => normalizeRole(row.role) === role && (row.status || "active") === "active");
    if (!permissionRows.length) return Array.from(new Set(staticGrants)).sort();

    const actions = ["read", "write", "create", "update", "delete", "back", "print", "export", "admin", "allow", "use"];
    const grants = new Set(staticGrants);
    permissionResources.forEach((resource) => {
      actions.forEach((action) => {
        if (can(role || "staff", action, resource, { tenantId })) grants.add(`${action}:${resource}`);
      });
    });
    return Array.from(grants).sort();
  }
  issueTokenPair({ tenant, user, branchId = "", deviceId = "" }) {
    ensureTenantUserAccessColumns();
    const permissions = this.permissionsForUser(user, tenant.id);
    const accessPayload = {
      iss: "aura-salon-api",
      aud: "aura-mobile",
      typ: "access",
      sub: user.id,
      tenantId: tenant.id,
      email: user.email,
      loginId: user.loginId || "",
      role: user.role,
      staffId: user.staffId || "",
      branchId,
      branchIds: user.branchIds || [],
      permissions,
      permissionVersion: Number(user.permissionVersion || 1),
      deviceId,
      jti: makeId("jwt")
    };
    const accessToken = this.signJwt(accessPayload, env.jwtAccessTtlSeconds);
    const refreshToken = `${makeId("refresh")}.${randomBytes(32).toString("base64url")}`;
    const refreshRecord = repositories.authRefreshTokens.create({
      id: makeId("rtok"),
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      deviceId,
      role: user.role,
      branchId,
      expiresAt: addDays(env.jwtRefreshTtlDays),
      revokedAt: ""
    }, { tenantId: tenant.id });
    return {
      tokenType: "Bearer",
      accessToken,
      expiresIn: env.jwtAccessTtlSeconds,
      refreshToken,
      refreshExpiresAt: refreshRecord.expiresAt,
      user: {
        id: user.id,
        name: user.name,
        loginId: user.loginId || "",
        email: user.email,
        role: user.role,
        staffId: user.staffId || "",
        branchId,
        branchIds: user.branchIds || [],
        permissions,
        permissionVersion: Number(user.permissionVersion || 1)
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        subscriptionStatus: tenant.subscriptionStatus
      }
    };
  }

  signJwt(payload, ttlSeconds) {
    const header = { alg: "HS256", typ: "JWT" };
    const body = {
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + Number(ttlSeconds)
    };
    const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(body))}`;
    return `${unsigned}.${sign(unsigned)}`;
  }

  verifyAccessToken(token) {
    const payload = this.verifyJwt(token);
    if (payload.typ !== "access") throw unauthorized("Access token type is invalid");
    return payload;
  }

  verifyJwt(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw unauthorized("JWT is malformed");
    const unsigned = `${parts[0]}.${parts[1]}`;
    if (!safeEqual(sign(unsigned), parts[2])) throw unauthorized("JWT signature is invalid");
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) throw unauthorized("JWT has expired");
    return payload;
  }

  registerDevice(payload = {}, access) {
    if (!payload.platform) throw badRequest("platform is required");
    const existing = payload.id ? repositories.mobileDevices.getById(payload.id, { tenantId: access.tenantId }) : null;
    const record = {
      userId: payload.userId || access.userId,
      branchId: payload.branchId || access.branchId || "",
      platform: payload.platform,
      deviceToken: payload.deviceToken || "",
      pushProvider: payload.pushProvider || "fcm",
      appVersion: payload.appVersion || "",
      capabilities: payload.capabilities || {},
      status: payload.status || "active",
      lastSeenAt: now()
    };
    if (existing) return repositories.mobileDevices.update(existing.id, record, { tenantId: access.tenantId });
    return repositories.mobileDevices.create({ id: payload.id || makeId("dev"), ...record }, { tenantId: access.tenantId });
  }
}

export const authService = new AuthService();

