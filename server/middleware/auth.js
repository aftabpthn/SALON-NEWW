import { authService } from "../services/auth.service.js";
import { tenantService } from "../services/tenant.service.js";
import { db } from "../db.js";
import { ensureTenantUserAccessColumns, normalizeRole } from "../services/access-control.service.js";
import { unauthorized } from "../utils/app-error.js";

function bearerToken(req) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : "";
}

function isBiometricGatewayRequest(req) {
  const path = String(req.path || "").replace(/^\/api\/v1/, "");
  return req.method === "POST"
    && /^\/staff-os\/biometric\/gateway\/[^/]+\/(?:heartbeat|events)\/?$/.test(path)
    && Boolean(req.get("x-tenant-id"))
    && Boolean(req.get("x-gateway-api-key"));
}

let clientsHasTenantId;

function clientsWhereClause() {
  if (clientsHasTenantId === undefined) {
    clientsHasTenantId = db.prepare("PRAGMA table_info(clients)").all().some((column) => column.name === "tenantId");
  }
  return clientsHasTenantId ? "tenantId = @tenantId AND id = @id" : "id = @id";
}

const permissionsCache = new Map();
function resolvePermissions(tenantId, userId, role, permissionVersion) {
  const key = `${tenantId}:${userId}:${permissionVersion}`;
  const cached = permissionsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const perms = authService.permissionsForUser({ role, id: userId }, tenantId);
  if (permissionsCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of permissionsCache) { if (v.expiresAt <= now) permissionsCache.delete(k); }
  }
  permissionsCache.set(key, { value: perms, expiresAt: Date.now() + 300_000 });
  return perms;
}

function setCustomerAccess(req, payload, tenant) {
  const customer = db.prepare(`SELECT id, email, branchId FROM clients WHERE ${clientsWhereClause()} LIMIT 1`).get({ tenantId: payload.tenantId, id: payload.sub });
  if (!customer) throw unauthorized("Customer session is invalid");

  const requestedBranchId = req.get("x-branch-id") || payload.branchId || customer.branchId || "";
  req.auth = payload;
  req.tenant = tenant;
  req.user = {
    id: payload.sub,
    email: payload.email || customer.email || "",
    loginId: payload.loginId || "",
    role: "customer",
    staffId: "",
    branchId: requestedBranchId,
    branchIds: requestedBranchId ? [requestedBranchId] : [],
    permissions: payload.permissions || []
  };
  req.access = {
    tenantId: payload.tenantId,
    role: "customer",
    userId: payload.sub,
    staffId: "",
    loginId: payload.loginId || "",
    branchId: requestedBranchId,
    branchIds: requestedBranchId ? [requestedBranchId] : [],
    permissions: payload.permissions || [],
    requestedBranchId,
    deviceId: payload.deviceId || "",
    jti: payload.jti || "",
    iat: payload.iat || 0
  };
}

export function authenticateJwt({ required = true } = {}) {
  return (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) {
      if (isBiometricGatewayRequest(req)) {
        next();
        return;
      }
      if (required) {
        next(unauthorized());
        return;
      }
      next();
      return;
    }
    try {
      const payload = authService.verifyAccessToken(token);
      payload.role = normalizeRole(payload.role);
      const tenant = tenantService.resolveTenant({ tenantId: payload.tenantId, host: req.get("host") || "" });

      if (payload.role === "customer") {
        setCustomerAccess(req, payload, tenant);
        next();
        return;
      }

      ensureTenantUserAccessColumns();
      const userRow = db.prepare("SELECT status, permissionVersion, staffId FROM tenant_users WHERE tenantId = @tenantId AND id = @id").get({ tenantId: payload.tenantId, id: payload.sub });
      if (!userRow || userRow.status !== "active") throw unauthorized("User session is no longer active");
      const tokenPermissionVersion = Number(payload.pv || payload.permissionVersion || 1);
      if (Number(userRow.permissionVersion || 1) !== tokenPermissionVersion) throw unauthorized("User permissions changed; please sign in again");
      const currentStaffId = String(userRow.staffId || payload.staffId || "").trim();
      const requestedBranchId = req.get("x-branch-id") || payload.branchId || "";
      if (requestedBranchId) tenantService.assertBranchAccess(payload, requestedBranchId);
      const permissions = payload.permissions || resolvePermissions(payload.tenantId, payload.sub, payload.role, tokenPermissionVersion);
      req.auth = payload;
      req.tenant = tenant;
      req.user = {
        id: payload.sub,
        email: payload.email || "",
        loginId: payload.loginId || "",
        role: payload.role,
        staffId: currentStaffId,
        branchId: requestedBranchId || payload.branchId || "",
        branchIds: payload.branchIds || [],
        permissions
      };
      req.access = {
        tenantId: payload.tenantId,
        role: payload.role,
        userId: payload.sub,
        staffId: currentStaffId,
        loginId: payload.loginId || "",
        branchId: requestedBranchId || payload.branchId || "",
        branchIds: payload.branchIds || [],
        permissions,
        permissionVersion: tokenPermissionVersion,
        requestedBranchId,
        deviceId: payload.deviceId || "",
        jti: payload.jti || "",
        iat: payload.iat || 0
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
