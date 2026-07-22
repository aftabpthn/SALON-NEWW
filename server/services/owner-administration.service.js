import { randomUUID } from "node:crypto";
import { db, columnsFor } from "../db.js";
import { staffAppPermissionCatalog } from "../config/staff-permission-catalog.js";
import { builtinRoles, can } from "../middleware/rbac.js";
import { securityService } from "./security.service.js";
import { generalSettingsService } from "./general-settings.service.js";
import { tenantService } from "./tenant.service.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/app-error.js";
import { assertActiveStaffAppRole, restoreStaffAppRoleDefaults, saveStaffAppRolePolicy, staffAppCatalogueKeys, staffAppRolePolicy } from "./staff-app-role-policy.service.js";

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();
const now = () => new Date().toISOString();
const jsonArray = (value) => { try { const parsed = Array.isArray(value) ? value : JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : []; } catch { return []; } };
const jsonObject = (value) => { try { const parsed = value && typeof value === "object" ? value : JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };
const branchStatuses = new Set(["active", "inactive"]);
const roleStatuses = new Set(["active", "inactive"]);
const userStatuses = new Set(["active", "hidden", "disabled", "suspended"]);
const roleActions = new Set(["read", "write", "admin", "allow", "create", "update", "delete", "export", "use"]);
const editableBranchFields = ["name", "city", "address", "phone", "gstin", "timezone", "status", "onlineBookingEnabled", "tierAdvanceBookingDays", "peakSlotsReservedPct", "peakHoursDefinition", "slug"];
const knownSettingSections = new Set(["workspace", "localization", "branchBehavior", "dateTime", "interface", "defaults"]);

function activeOwner(access = {}) {
  if (lower(access.role) !== "owner") throw forbidden("Active owner access is required");
  const owner = db.prepare(`SELECT id, tenantId, role, status, branchIds, permissionVersion FROM tenant_users WHERE tenantId = @tenantId AND id = @id`).get({ tenantId: text(access.tenantId), id: text(access.userId) });
  if (!owner || lower(owner.role) !== "owner" || lower(owner.status) !== "active") throw forbidden("Active owner access is required");
  return { ...owner, branchIds: [...new Set(jsonArray(owner.branchIds))] };
}

function requireGrant(access, action, resource) {
  if (!can(access.role, action, resource, access)) throw forbidden(`Permission required: ${action}:${resource}`);
}

function branchById(owner, branchId, { requireAssigned = true } = {}) {
  const id = text(branchId);
  const branch = db.prepare(`SELECT * FROM branches WHERE tenantId = @tenantId AND id = @id`).get({ tenantId: owner.tenantId, id });
  if (!branch) throw notFound("Branch not found in this tenant");
  if (requireAssigned && !owner.branchIds.includes(id)) throw forbidden("The requested branch is not assigned to this owner");
  return branch;
}

function branchView(row) {
  const columns = new Set(columnsFor("branches"));
  return Object.fromEntries(editableBranchFields.concat(["id", "createdAt", "updatedAt"]).filter((key) => columns.has(key) && row[key] !== undefined).map((key) => [key, row[key]]));
}

function normalizeBranchPayload(payload = {}, existing = null) {
  const columns = new Set(columnsFor("branches"));
  const next = {};
  for (const key of editableBranchFields) if (columns.has(key) && payload[key] !== undefined) next[key] = typeof payload[key] === "string" ? text(payload[key]) : payload[key];
  const name = payload.name === undefined ? existing?.name : text(payload.name);
  const city = payload.city === undefined ? existing?.city : text(payload.city);
  if (!name || !city) throw badRequest("Branch name and city are required");
  if (next.status !== undefined && !branchStatuses.has(lower(next.status))) throw badRequest("Branch status must be active or inactive");
  if (next.timezone !== undefined && !/^[A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/.test(next.timezone)) throw badRequest("Use a valid IANA timezone, for example Asia/Kolkata");
  if (next.peakSlotsReservedPct !== undefined) {
    const value = Number(next.peakSlotsReservedPct);
    if (!Number.isInteger(value) || value < 0 || value > 100) throw badRequest("Peak slot reserve must be a whole percentage from 0 to 100");
    next.peakSlotsReservedPct = value;
  }
  if (next.onlineBookingEnabled !== undefined) next.onlineBookingEnabled = next.onlineBookingEnabled === true || next.onlineBookingEnabled === 1 ? 1 : 0;
  if (next.tierAdvanceBookingDays !== undefined && typeof next.tierAdvanceBookingDays !== "string") next.tierAdvanceBookingDays = JSON.stringify(next.tierAdvanceBookingDays);
  return next;
}

function assignedBranches(owner) {
  if (!owner.branchIds.length) return [];
  const params = { tenantId: owner.tenantId };
  const slots = owner.branchIds.map((id, index) => { params[`id${index}`] = id; return `@id${index}`; });
  return db.prepare(`SELECT * FROM branches WHERE tenantId = @tenantId AND id IN (${slots.join(",")}) ORDER BY name COLLATE NOCASE, id`).all(params).map(branchView);
}

function validateBranchAssignments(owner, branchIds, role) {
  const ids = [...new Set((Array.isArray(branchIds) ? branchIds : []).map(text).filter(Boolean))];
  if ((text(role) === "owner" || !["admin", "superAdmin"].includes(text(role))) && !ids.length) throw badRequest("At least one branch is required for this role");
  for (const id of ids) branchById(owner, id);
  return ids;
}

function assertAssignableRole(role, access, branchIds = []) {
  const management = securityService.permissionMatrix(access);
  const found = management.roles.find((item) => item.role === role);
  if (!found) throw badRequest("Role does not exist");
  for (const branchId of branchIds.length ? branchIds : [""]) assertActiveStaffAppRole(access.tenantId, role, branchId, { assignable: true });
}

function catalogueKeys() {
  return new Set(staffAppCatalogueKeys());
}

function validatePermissionKeys(keys) {
  const catalogue = catalogueKeys();
  const clean = [...new Set((Array.isArray(keys) ? keys : []).map(text).filter(Boolean))];
  for (const key of clean) {
    const separator = key.indexOf(":");
    const action = key.slice(0, separator);
    const resource = key.slice(separator + 1);
    if (separator < 1 || !roleActions.has(action) || !catalogue.has(`${action}:${resource}`)) throw badRequest(`Unknown permission: ${key}`);
  }
  return clean;
}

function permissionRows(keys, status = "active") {
  const grouped = new Map();
  for (const key of keys) {
    const [action, ...parts] = key.split(":");
    const resource = parts.join(":");
    if (!grouped.has(resource)) grouped.set(resource, []);
    grouped.get(resource).push(action);
  }
  return [...grouped].map(([resource, actions]) => ({ resource, actions, effect: "allow", status }));
}

function rolePermissionKeys(management, role) {
  const definition = management.customRoles?.find((item) => item.role === role);
  const configured = Array.isArray(definition?.permissions) ? definition.permissions : management.permissionRows?.filter((item) => item.role === role) || [];
  const keys = configured.flatMap((item) => jsonArray(item.actions).map((action) => `${action}:${item.resource}`));
  if (keys.length) return [...new Set(keys)];
  return management.roles.find((item) => item.role === role)?.staticGrants?.filter((key) => key.includes(":")) || [];
}

function userInOwnerScope(user, owner) {
  if (user.id === owner.id) return true;
  const assigned = jsonArray(user.branchIds);
  return assigned.some((branchId) => owner.branchIds.includes(branchId));
}

function accessCatalogue(access, owner, branchId = "") {
  if (branchId) branchById(owner, branchId);
  const management = securityService.userManagement(access);
  const visibleUsers = management.users.filter((user) => userInOwnerScope(user, owner));
  const staffAppKeys = catalogueKeys();
  const permissionGroups = [...new Map(staffAppPermissionCatalog.map((item) => [item.groupKey, { key: item.groupKey, label: item.groupLabel }])).values()].map((group) => {
    const items = staffAppPermissionCatalog.filter((item) => item.groupKey === group.key).map((item) => ({ key: `${item.action}:${item.resource}`, label: item.label, resource: item.resource, action: item.action, sensitive: item.groupKey === "staff-os-sensitive" || ["staff-app-finance", "staff-app-payroll"].includes(item.resource), apiTargets: item.apiTargets }));
    return { ...group, items: [...new Map(items.map((item) => [item.key, item])).values()] };
  });
  return {
    branches: assignedBranches(owner),
    roles: management.roles.map((role) => {
      const policy = staffAppRolePolicy(owner.tenantId, branchId, role.role);
      const assigned = visibleUsers.filter((user) => user.role === role.role && (!branchId || jsonArray(user.branchIds).includes(branchId)));
      return {
        ...role,
        status: policy.status,
        permissionKeys: policy.effectiveKeys.filter((key) => staffAppKeys.has(key)),
        configuredKeys: policy.configuredKeys,
        inheritedKeys: policy.inheritedKeys,
        effectiveKeys: policy.effectiveKeys,
        allowKeys: policy.allowKeys,
        denyKeys: policy.denyKeys,
        policyMode: policy.mode,
        policySource: policy.source,
        editablePolicy: policy.editablePolicy,
        kind: policy.kind,
        editable: policy.kind === "custom",
        assignedUserCount: assigned.length,
        activeAssignedUserCount: assigned.filter((user) => user.status === "active").length
      };
    }),
    users: visibleUsers,
    permissionGroups,
    capabilities: { createRole: true, editCustomRole: true, editBuiltinStaffAppPolicy: true, restoreRoleDefaults: true, duplicateRole: true, setCustomRoleStatus: true, createUser: true, updateUser: true, disableUser: true },
    safeguards: { lastActiveOwner: true, ownerEssentialAccess: true, assignmentsLimitedToOwnerBranches: true, permissionVersionInvalidation: true }
  };
}

function parseStoredSettings(tenantId, branchId) {
  const key = `general.settings.${branchId || "all"}`;
  const row = db.prepare(`SELECT value FROM settings WHERE tenantId = @tenantId AND key = @key`).get({ tenantId, key });
  if (!row?.value) return {};
  try { return JSON.parse(row.value) || {}; } catch { return {}; }
}

function deepMerge(base, patch) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return patch;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch || {})) result[key] = value && typeof value === "object" && !Array.isArray(value) ? deepMerge(result[key], value) : value;
  return result;
}

function validateSettingsPatch(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw badRequest("settings object is required");
  for (const key of Object.keys(settings)) if (!knownSettingSections.has(key)) throw badRequest(`Unsupported settings section: ${key}`);
}

export const ownerAdministrationService = {
  branches(access) {
    requireGrant(access, "read", "branches");
    const owner = activeOwner(access);
    return { items: assignedBranches(owner), capabilities: { create: true, update: true, deactivate: true, hardDelete: false, creatorAssignment: true }, availability: { holidays: "No validated branch holiday write contract", tax: "Managed by the dedicated tax settings contract", invoice: "Managed by the dedicated bill settings contract", staff: "Managed in Staff", services: "Managed in Services", manager: "Manager assignment is controlled through user access" } };
  },

  createBranch(payload, access, req) {
    requireGrant(access, "write", "branches");
    const owner = activeOwner(access);
    const data = normalizeBranchPayload(payload);
    tenantService.enforceUsageLimit(owner.tenantId, "branches");
    const stamp = now();
    const columns = new Set(columnsFor("branches"));
    const row = { id: `branch_${randomUUID().slice(0, 10)}`, tenantId: owner.tenantId, name: data.name, city: data.city, status: data.status || "active", timezone: data.timezone || "Asia/Kolkata", createdAt: stamp, updatedAt: stamp, ...data };
    const fields = Object.keys(row).filter((key) => columns.has(key));
    const run = db.transaction(() => {
      db.prepare(`INSERT INTO branches (${fields.join(",")}) VALUES (${fields.map((key) => `@${key}`).join(",")})`).run(row);
      const branchIds = [...owner.branchIds, row.id];
      db.prepare(`UPDATE tenant_users SET branchIds = @branchIds, permissionVersion = COALESCE(permissionVersion, 0) + 1, updatedAt = @updatedAt WHERE tenantId = @tenantId AND id = @id AND role = 'owner' AND status = 'active'`).run({ branchIds: JSON.stringify(branchIds), updatedAt: stamp, tenantId: owner.tenantId, id: owner.id });
      tenantService.recordUsage({ tenantId: owner.tenantId, metric: "branches", referenceType: "branches", referenceId: row.id });
      return branchView(db.prepare(`SELECT * FROM branches WHERE tenantId = @tenantId AND id = @id`).get({ tenantId: owner.tenantId, id: row.id }));
    });
    const branch = run();
    securityService.audit({ action: "owner.branch.created", targetType: "branches", targetId: branch.id, details: { fields: Object.keys(data), creatorAssigned: true, permissionVersionInvalidated: true } }, access, req);
    return { branch, creatorAssigned: true, requiresReauthentication: true };
  },

  updateBranch(branchId, payload, access, req) {
    requireGrant(access, "write", "branches");
    const owner = activeOwner(access);
    const existing = branchById(owner, branchId);
    const data = normalizeBranchPayload(payload, existing);
    delete data.status;
    if (!Object.keys(data).length) throw badRequest("No supported branch fields were provided");
    const stamp = now();
    const fields = Object.keys(data);
    db.prepare(`UPDATE branches SET ${fields.map((key) => `${key} = @${key}`).join(", ")}, updatedAt = @updatedAt WHERE tenantId = @tenantId AND id = @id`).run({ ...data, updatedAt: stamp, tenantId: owner.tenantId, id: existing.id });
    const branch = branchView(branchById(owner, existing.id));
    securityService.audit({ action: "owner.branch.updated", targetType: "branches", targetId: branch.id, details: { fields } }, access, req);
    return { branch };
  },

  setBranchStatus(branchId, status, access, req) {
    requireGrant(access, "write", "branches");
    const owner = activeOwner(access);
    const existing = branchById(owner, branchId);
    const next = lower(status);
    if (!branchStatuses.has(next)) throw badRequest("Branch status must be active or inactive");
    db.prepare(`UPDATE branches SET status = @status, updatedAt = @updatedAt WHERE tenantId = @tenantId AND id = @id`).run({ status: next, updatedAt: now(), tenantId: owner.tenantId, id: existing.id });
    securityService.audit({ action: "owner.branch.status_changed", targetType: "branches", targetId: existing.id, details: { from: existing.status, to: next, hardDelete: false } }, access, req);
    return { branch: branchView(branchById(owner, existing.id)) };
  },

  access(access, query = {}) {
    requireGrant(access, "read", "security");
    return accessCatalogue(access, activeOwner(access), text(query.branchId));
  },

  saveRole(payload, access, req) {
    requireGrant(access, "write", "security");
    const owner = activeOwner(access);
    const role = text(payload.role);
    const existing = db.prepare(`SELECT * FROM role_definitions WHERE tenantId = @tenantId AND role = @role`).get({ tenantId: owner.tenantId, role });
    const catalogueRole = securityService.permissionMatrix(access).roles.find((item) => item.role === role);
    if (!role) throw badRequest("Role is required");
    const isBuiltin = builtinRoles().includes(role);
    if ((existing || isBuiltin) && (payload.createOnly === true || payload.intent === "create")) throw conflict(`Role '${role}' already exists`);
    if (["owner", "superAdmin"].includes(role)) throw forbidden("Owner and super admin access cannot be changed");
    const branchId = text(payload.branchId);
    if (branchId) branchById(owner, branchId);
    const currentPolicy = staffAppRolePolicy(owner.tenantId, branchId, role);
    const status = lower(payload.status || currentPolicy.status || existing?.status || "active");
    if (!roleStatuses.has(status)) throw badRequest("Role status must be active or inactive");
    const hasConfiguredKeys = Object.prototype.hasOwnProperty.call(payload, "permissionKeys") || Object.prototype.hasOwnProperty.call(payload, "allowKeys");
    const keys = hasConfiguredKeys ? validatePermissionKeys(payload.permissionKeys ?? payload.allowKeys ?? []) : currentPolicy.allowKeys;
    const denyKeys = payload.denyKeys !== undefined
      ? validatePermissionKeys(payload.denyKeys)
      : hasConfiguredKeys ? staffAppCatalogueKeys().filter((key) => !keys.includes(key)) : currentPolicy.denyKeys;
    const mode = payload.mode === "inherited" ? "inherited" : payload.mode === "override" || hasConfiguredKeys || payload.denyKeys !== undefined ? "override" : currentPolicy.mode;
    const appResources = [...new Set(staffAppPermissionCatalog.map((item) => item.resource))];
    let savedDefinition = null;
    if (!isBuiltin) {
      const storedPermissions = db.prepare(`SELECT resource, actions, effect, conditions, status FROM security_permissions WHERE tenantId = @tenantId AND role = @role`).all({ tenantId: owner.tenantId, role });
      const preservedPermissions = storedPermissions.filter((item) => !appResources.includes(item.resource)).map((item) => ({ ...item, actions: jsonArray(item.actions), conditions: jsonObject(item.conditions) }));
      savedDefinition = securityService.upsertRoleDefinition({ role, name: text(payload.name || existing?.name || role), description: payload.description === undefined ? existing?.description || "" : text(payload.description), status, permissions: preservedPermissions, isSystem: false, skipPermissionVersionInvalidation: true }, access, req).definition;
    }
    const saved = saveStaffAppRolePolicy({ tenantId: owner.tenantId, branchId, role, mode, allowKeys: keys, denyKeys, status, updatedBy: owner.id, tenantWideStatusChange: !isBuiltin && Boolean(existing) && existing.status !== status });
    securityService.audit({ action: "staff_app_role_policy.updated", targetType: "role_definition", targetId: role, details: { branchId, mode, status, effectiveKeys: saved.policy.effectiveKeys, impact: saved.impact } }, access, req);
    return { role: { ...(savedDefinition || catalogueRole), ...saved.policy }, policy: saved.policy, impact: saved.impact, invalidatedUsers: saved.impact.affectedUsers, requiresReauthentication: saved.impact.requiresReauthentication, access: accessCatalogue(access, activeOwner(access), branchId) };
  },

  restoreRoleDefaults(role, payload, access, req) {
    requireGrant(access, "write", "security");
    const owner = activeOwner(access);
    const branchId = text(payload?.branchId);
    if (branchId) branchById(owner, branchId);
    const restored = restoreStaffAppRoleDefaults({ tenantId: owner.tenantId, branchId, role: text(role), updatedBy: owner.id });
    securityService.audit({ action: "staff_app_role_policy.restored", targetType: "role_definition", targetId: text(role), details: { branchId, impact: restored.impact } }, access, req);
    return { role: restored.policy, policy: restored.policy, impact: restored.impact, invalidatedUsers: restored.impact.affectedUsers, requiresReauthentication: restored.impact.requiresReauthentication, access: accessCatalogue(access, activeOwner(access), branchId) };
  },

  createUser(payload, access, req) {
    requireGrant(access, "write", "security");
    const owner = activeOwner(access);
    const role = text(payload.role);
    const branchIds = validateBranchAssignments(owner, payload.branchIds, role);
    assertAssignableRole(role, access, branchIds);
    const result = securityService.createTenantUser({ ...payload, role, branchIds, status: userStatuses.has(lower(payload.status)) ? lower(payload.status) : "active" }, access, req);
    return { user: result.user, access: accessCatalogue(access, activeOwner(access)) };
  },

  updateUser(userId, payload, access, req) {
    requireGrant(access, "write", "security");
    const owner = activeOwner(access);
    const existing = db.prepare(`SELECT * FROM tenant_users WHERE tenantId = @tenantId AND id = @id`).get({ tenantId: owner.tenantId, id: text(userId) });
    if (!existing) throw notFound("User not found");
    if (!userInOwnerScope(existing, owner)) throw forbidden("This user is outside the owner's assigned branches");
    if (["owner", "superAdmin"].includes(existing.role) && existing.id !== owner.id) throw forbidden("Existing owner and super admin accounts cannot be changed here");
    const role = payload.role === undefined ? existing.role : text(payload.role);
    const branchIds = payload.branchIds === undefined ? jsonArray(existing.branchIds) : validateBranchAssignments(owner, payload.branchIds, role);
    if (!["owner", "superAdmin"].includes(role) || role !== existing.role) assertAssignableRole(role, access, branchIds);
    if (existing.id === owner.id && (role !== "owner" || (payload.status !== undefined && lower(payload.status) !== "active"))) throw forbidden("Your active owner access cannot be removed from this session");
    const result = securityService.updateTenantUser(existing.id, { ...payload, role, branchIds }, access, req);
    return { user: result.user, access: accessCatalogue(access, activeOwner(access)) };
  },

  settings(query, access) {
    requireGrant(access, "read", "settings");
    const owner = activeOwner(access);
    const branchId = text(query.branchId);
    if (branchId) branchById(owner, branchId);
    return { ...generalSettingsService.get({ branchId }, { ...access, branchIds: owner.branchIds }), supportedSections: [...knownSettingSections], unavailableSections: { branding: "Use the existing white-label contract", tax: "Use tax settings", appointments: "Use booking and calendar settings", cancellation: "Use booking settings", attendance: "Use staff attendance settings", payroll: "Use payroll settings", integrations: "Use marketplace integrations" } };
  },

  saveSettings(payload, access) {
    requireGrant(access, "write", "settings");
    const owner = activeOwner(access);
    const branchId = text(payload.branchId);
    if (branchId) branchById(owner, branchId);
    validateSettingsPatch(payload.settings);
    const stored = parseStoredSettings(owner.tenantId, branchId);
    const storedSettings = stored.settings && typeof stored.settings === "object" ? stored.settings : stored;
    const merged = deepMerge(storedSettings, payload.settings);
    const normalized = generalSettingsService.save({ branchId, settings: merged }, { ...access, branchIds: owner.branchIds, user: { id: owner.id } });
    const preserved = deepMerge(storedSettings, normalized.settings);
    const key = `general.settings.${branchId || "all"}`;
    db.prepare(`UPDATE settings SET value = @value, updatedAt = @updatedAt WHERE tenantId = @tenantId AND key = @key`).run({ value: JSON.stringify({ branchId, settings: preserved, audit: normalized.audit }), updatedAt: normalized.audit.lastChangedAt, tenantId: owner.tenantId, key });
    return { branchId, settings: normalized.settings, audit: normalized.audit, preservedUnknownSettings: true };
  }
};
