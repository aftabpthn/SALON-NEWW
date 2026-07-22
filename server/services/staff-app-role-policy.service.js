import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { staffAppPermissionCatalog } from "../config/staff-permission-catalog.js";
import { badRequest, forbidden } from "../utils/app-error.js";

const protectedRoles = new Set(["owner", "superAdmin"]);
const fullAccessRoles = new Set(["owner", "superAdmin", "admin"]);
const writeAliases = new Set(["create", "update", "delete", "back", "print", "export"]);
const builtinRoleNames = new Set(["owner", "superAdmin", "admin", "manager", "receptionist", "frontDesk", "cashier", "accountant", "inventoryManager", "marketingLead", "customMarketingLead", "staff", "analyst"]);
const now = () => new Date().toISOString();
const text = (value) => String(value ?? "").trim();
let schemaReady = false;

function jsonArray(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value || "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.map(text).filter(Boolean))] : [];
  } catch {
    return [];
  }
}

export function staffAppCatalogueKeys() {
  return [...new Set(staffAppPermissionCatalog.map((item) => `${item.action}:${item.resource}`))];
}

function keySet(...keys) {
  const catalogue = new Set(staffAppCatalogueKeys());
  return keys.flat().filter((key) => catalogue.has(key));
}

function builtinDefaults(role) {
  const all = staffAppCatalogueKeys();
  if (fullAccessRoles.has(role)) return all;
  const scheduling = keySet("read:staff-app-appointments", "update:staff-app-appointments", "write:staff-app-appointments");
  const teamSelf = keySet("read:staff-app-staff", "write:staff-app-staff", "update:staff-app-staff", "allow:staff-app-checkin-checkout");
  const notices = keySet("read:staff-app-notifications", "update:staff-app-notifications");
  const finance = keySet("read:staff-app-finance", "read:staff-app-payroll", "read:staff-app-sales", "read:staff-app-payments", "read:staff-app-invoices");
  const selfService = keySet("read:staff-app-schedules", "read:staff-app-attendance", "write:staff-app-attendance", "read:staff-app-leave", "write:staff-app-leave", "read:staff-app-mobile", "write:staff-app-mobile", "read:staff-app-tasks", "write:staff-app-tasks");
  if (role === "manager") return [...scheduling, ...teamSelf, ...notices, ...selfService, ...keySet("read:staff-app-master", "write:staff-app-schedules")];
  if (role === "staff") return [...scheduling, ...teamSelf, ...notices, ...selfService, ...keySet("read:staff-app-payroll")];
  if (["receptionist", "frontDesk"].includes(role)) return [...scheduling, ...teamSelf, ...notices, ...selfService, ...keySet("read:staff-app-sales", "read:staff-app-payments", "read:staff-app-invoices")];
  if (role === "cashier") return [...notices, ...keySet("read:staff-app-sales", "read:staff-app-payments", "read:staff-app-invoices")];
  if (role === "accountant") return [...finance, ...notices, ...keySet("write:staff-app-payroll")];
  if (["marketingLead", "customMarketingLead"].includes(role)) return notices;
  if (role === "analyst") return [...finance, ...notices, ...keySet("read:staff-app-staff")];
  return [];
}

export function ensureStaffAppRolePolicySchema() {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS staffAppRolePolicies (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'inherited' CHECK(mode IN ('inherited', 'override')),
      allowKeys TEXT NOT NULL DEFAULT '[]',
      denyKeys TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      updatedBy TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, role)
    );
    CREATE INDEX IF NOT EXISTS idx_staff_app_role_policy_scope
      ON staffAppRolePolicies(tenantId, branchId, role);
  `);
  schemaReady = true;
}

function roleDefinition(tenantId, role) {
  return db.prepare(`SELECT role, name, description, isSystem, status, permissions
    FROM role_definitions WHERE tenantId = @tenantId AND role = @role LIMIT 1`).get({ tenantId, role });
}

function inheritedKeys(tenantId, role) {
  if (builtinRoleNames.has(role)) return builtinDefaults(role);
  const definition = roleDefinition(tenantId, role);
  if (!definition) return [];
  return [];
}

function policyRow(tenantId, branchId, role) {
  ensureStaffAppRolePolicySchema();
  return db.prepare(`SELECT * FROM staffAppRolePolicies
    WHERE tenantId = @tenantId AND role = @role AND branchId IN (@branchId, '')
    ORDER BY CASE WHEN branchId = @branchId AND @branchId <> '' THEN 0 ELSE 1 END LIMIT 1`).get({ tenantId, branchId: branchId || "", role });
}

export function staffAppRolePolicy(tenantId, branchId, role) {
  ensureStaffAppRolePolicySchema();
  role = text(role);
  const definition = roleDefinition(tenantId, role);
  const inherited = inheritedKeys(tenantId, role);
  const row = policyRow(tenantId, branchId, role);
  const allowKeys = jsonArray(row?.allowKeys).filter((key) => staffAppCatalogueKeys().includes(key));
  const denyKeys = jsonArray(row?.denyKeys).filter((key) => staffAppCatalogueKeys().includes(key));
  const mode = row?.mode === "override" ? "override" : "inherited";
  const effective = mode === "override"
    ? [...new Set([...inherited, ...allowKeys])].filter((key) => !denyKeys.includes(key))
    : inherited;
  if (protectedRoles.has(role)) effective.splice(0, effective.length, ...staffAppCatalogueKeys());
  return {
    role,
    branchId: row?.branchId || branchId || "",
    mode,
    source: mode === "override" ? (row?.branchId ? "branch-override" : "tenant-override") : "default",
    inheritedKeys: inherited,
    configuredKeys: mode === "override" ? allowKeys : [],
    allowKeys,
    denyKeys,
    effectiveKeys: [...new Set(effective)].sort(),
    status: protectedRoles.has(role) ? "active" : (!builtinRoleNames.has(role) ? definition?.status || "active" : row?.status || "active"),
    editablePolicy: !protectedRoles.has(role),
    kind: builtinRoleNames.has(role) ? "system" : "custom"
  };
}

export function staffAppPermissionAllowed(role, action, resource, access = {}) {
  if (!String(resource || "").startsWith("staff-app-")) return false;
  const policy = staffAppRolePolicy(access.tenantId || "", access.branchId || access.requestedBranchId || "", role);
  if (policy.status !== "active") return false;
  if (policy.denyKeys.includes(`${action}:${resource}`)) return false;
  const actions = [action, ...(writeAliases.has(action) ? ["write"] : [])];
  return actions.some((candidate) => policy.effectiveKeys.includes(`${candidate}:${resource}`));
}

export function assertActiveStaffAppRole(tenantId, role, branchId = "", { assignable = false } = {}) {
  role = text(role);
  const definition = roleDefinition(tenantId, role);
  if (!builtinRoleNames.has(role) && !definition) throw badRequest(`Unknown staff role: ${role}`);
  const policy = staffAppRolePolicy(tenantId, branchId, role);
  if (policy.status !== "active") throw forbidden(`Role '${role}' is inactive`);
  if (assignable && protectedRoles.has(role)) throw forbidden(`Role '${role}' is not assignable as a staff role`);
  return policy;
}

function affectedUsers(tenantId, role, branchId) {
  const rows = db.prepare(`SELECT id, status, branchIds FROM tenant_users WHERE tenantId = @tenantId AND role = @role`).all({ tenantId, role });
  return branchId ? rows.filter((row) => {
    const branches = jsonArray(row.branchIds);
    return !branches.length || branches.includes(branchId);
  }) : rows;
}

function invalidateUsers(tenantId, users) {
  if (!users.length) return;
  const params = { tenantId, updatedAt: now() };
  const slots = users.map((user, index) => {
    params[`userId${index}`] = user.id;
    return `@userId${index}`;
  });
  db.prepare(`UPDATE tenant_users SET permissionVersion = COALESCE(permissionVersion, 1) + 1, updatedAt = @updatedAt
    WHERE tenantId = @tenantId AND id IN (${slots.join(", ")})`).run(params);
  db.prepare(`UPDATE auth_refresh_tokens SET revokedAt = @updatedAt, updatedAt = @updatedAt
    WHERE tenantId = @tenantId AND userId IN (${slots.join(", ")}) AND COALESCE(revokedAt, '') = ''`).run(params);
  db.prepare(`UPDATE security_sessions SET revokedAt = @updatedAt, status = 'revoked', updatedAt = @updatedAt
    WHERE tenantId = @tenantId AND userId IN (${slots.join(", ")}) AND status = 'active' AND COALESCE(revokedAt, '') = ''`).run(params);
}

function activeSessionCount(tenantId, users) {
  if (!users.length) return 0;
  const params = { tenantId };
  const slots = users.map((user, index) => {
    params[`sessionUserId${index}`] = user.id;
    return `@sessionUserId${index}`;
  });
  const row = db.prepare(`SELECT COUNT(*) AS total FROM security_sessions
    WHERE tenantId = @tenantId AND userId IN (${slots.join(", ")}) AND status = 'active' AND COALESCE(revokedAt, '') = ''`).get(params);
  return Number(row?.total || 0);
}

export function saveStaffAppRolePolicy({ tenantId, branchId = "", role, mode = "override", allowKeys = [], denyKeys = [], status = "active", updatedBy = "", tenantWideStatusChange = false }) {
  ensureStaffAppRolePolicySchema();
  role = text(role);
  branchId = text(branchId);
  if (protectedRoles.has(role)) throw forbidden("Owner and super admin Staff App access cannot be changed");
  if (!builtinRoleNames.has(role) && !roleDefinition(tenantId, role)) throw badRequest("Role does not exist");
  if (!["inherited", "override"].includes(mode)) throw badRequest("Policy mode must be inherited or override");
  if (!["active", "inactive"].includes(status)) throw badRequest("Role status must be active or inactive");
  const catalogue = new Set(staffAppCatalogueKeys());
  allowKeys = jsonArray(allowKeys);
  denyKeys = jsonArray(denyKeys);
  for (const key of [...allowKeys, ...denyKeys]) if (!catalogue.has(key)) throw badRequest(`Unknown Staff App permission: ${key}`);
  if (allowKeys.some((key) => denyKeys.includes(key))) throw badRequest("A Staff App permission cannot be both allowed and denied");
  const definition = roleDefinition(tenantId, role);
  const isCustom = !builtinRoleNames.has(role);
  if (isCustom && definition?.status !== status) {
    db.prepare(`UPDATE role_definitions SET status = @status, updatedAt = @updatedAt WHERE tenantId = @tenantId AND role = @role`).run({ status, updatedAt: now(), tenantId, role });
  }
  const stamp = now();
  db.prepare(`INSERT INTO staffAppRolePolicies
    (id, tenantId, branchId, role, mode, allowKeys, denyKeys, status, updatedBy, createdAt, updatedAt)
    VALUES (@id, @tenantId, @branchId, @role, @mode, @allowKeys, @denyKeys, @status, @updatedBy, @createdAt, @updatedAt)
    ON CONFLICT(tenantId, branchId, role) DO UPDATE SET
      mode = excluded.mode, allowKeys = excluded.allowKeys, denyKeys = excluded.denyKeys,
      status = excluded.status, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`).run({
    id: `staff_policy_${randomUUID().slice(0, 10)}`, tenantId, branchId, role, mode,
    allowKeys: JSON.stringify(mode === "override" ? allowKeys : []),
    denyKeys: JSON.stringify(mode === "override" ? denyKeys : []),
    status: isCustom ? "active" : status, updatedBy, createdAt: stamp, updatedAt: stamp
  });
  const tenantWideImpact = isCustom && (tenantWideStatusChange || definition?.status !== status);
  const users = affectedUsers(tenantId, role, tenantWideImpact ? "" : branchId);
  const affectedActiveSessions = activeSessionCount(tenantId, users);
  invalidateUsers(tenantId, users);
  return {
    policy: staffAppRolePolicy(tenantId, branchId, role),
    impact: {
      affectedUsers: users.length,
      activeAffectedUsers: users.filter((user) => user.status === "active").length,
      requiresReauthentication: users.length > 0,
      permissionVersionIncremented: users.length,
      affectedActiveSessions,
      scope: tenantWideImpact ? "tenant" : branchId ? "branch" : "tenant",
      branchId: tenantWideImpact ? "" : branchId
    }
  };
}

export function restoreStaffAppRoleDefaults({ tenantId, branchId = "", role, updatedBy = "" }) {
  const current = staffAppRolePolicy(tenantId, branchId, role);
  return saveStaffAppRolePolicy({ tenantId, branchId, role, mode: "inherited", allowKeys: [], denyKeys: [], status: current.status, updatedBy });
}
