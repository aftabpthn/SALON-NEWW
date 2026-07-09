import { randomUUID } from "node:crypto";
import { forbidden, unauthorized } from "../utils/app-error.js";
import { db } from "../db.js";

const permissions = {
  superAdmin: ["*"],
  owner: ["*"],
  admin: ["*"],
  manager: [
    "read:dashboard",
    "read:appointments",
    "read:clients",
    "read:services",
    "read:products",
    "read:inventory",
    "read:sales",
    "use:pos",
    "read:invoices",
    "read:payments",
    "read:notifications",
    "write:notifications",
    "read:staff",
    "read:reports",
    "write:clients",
    "write:appointments",
    "write:services",
    "write:products",
    "write:inventory",
    "write:sales",
    "write:invoices",
    "write:payments",
    "write:appointment_deposits",
    "write:staff"
  ],
  receptionist: [
    "read:dashboard",
    "read:appointments",
    "read:clients",
    "read:services",
    "read:products",
    "read:sales",
    "use:pos",
    "read:invoices",
    "read:payments",
    "read:notifications",
    "write:notifications",
    "write:clients",
    "write:appointments",
    "write:sales",
    "write:invoices",
    "write:payments",
    "write:appointment_deposits",
    "write:smart-booking",
    "read:smart-booking",
    "read:booking-portal",
    "write:booking-portal"
  ],
  frontDesk: [
    "read:dashboard",
    "read:appointments",
    "read:clients",
    "read:services",
    "read:products",
    "read:sales",
    "use:pos",
    "read:invoices",
    "read:payments",
    "read:notifications",
    "write:notifications",
    "write:clients",
    "write:appointments",
    "write:sales",
    "write:invoices",
    "write:payments",
    "write:appointment_deposits",
    "write:smart-booking",
    "read:smart-booking",
    "read:booking-portal",
    "write:booking-portal"
  ],
  cashier: [
    "read:dashboard",
    "read:clients",
    "read:services",
    "read:products",
    "read:sales",
    "use:pos",
    "read:invoices",
    "read:payments",
    "read:notifications",
    "write:notifications",
    "write:clients",
    "write:sales",
    "write:invoices",
    "write:payments",
    "read:appointment_deposits",
    "write:appointment_deposits"
  ],
  accountant: [
    "read:dashboard",
    "read:finance",
    "read:invoices",
    "read:payments",
    "read:finance",
    "write:finance",
    "read:invoices",
    "write:invoices",
    "read:payments",
    "write:payments",
    "read:appointment_deposits",
    "read:reports",
    "read:analytics"
  ],
  inventoryManager: [
    "read:dashboard",
    "read:products",
    "write:products",
    "read:inventory",
    "write:inventory",
    "read:inventory-intelligence",
    "write:inventory-intelligence",
    "read:suppliers",
    "write:suppliers"
  ],
  marketingLead: [
    "read:dashboard",
    "read:marketing",
    "write:marketing",
    "read:campaigns",
    "write:campaigns",
    "read:clients",
    "read:leads",
    "write:leads",
    "read:coupons",
    "write:coupons",
    "read:whatsapp",
    "write:whatsapp",
    "read:notifications",
    "write:notifications",
    "read:reviews",
    "read:reputation",
    "write:reputation"
  ],
  customMarketingLead: [
    "read:dashboard",
    "read:marketing",
    "write:marketing",
    "read:campaigns",
    "write:campaigns",
    "read:clients",
    "read:leads",
    "write:leads",
    "read:coupons",
    "write:coupons",
    "read:whatsapp",
    "write:whatsapp",
    "read:notifications",
    "write:notifications",
    "read:reviews",
    "read:reputation",
    "write:reputation"
  ],
  staff: [
    "read:appointments",
    "read:clients",
    "read:services",
    "read:products",
    "write:appointments"
  ],
  analyst: ["read:*", "read:reports", "read:analytics", "write:analytics", "read:ai", "read:whatsapp", "write:ai", "read:security", "read:quality", "read:deployment", "read:future-features", "write:future-features", "read:finance", "read:customer-360", "read:workflows"]
};

const cappedBuiltinRoles = new Set(["manager", "receptionist", "frontDesk", "cashier", "accountant", "inventoryManager", "staff"]);

export function normalizeRole(role = "") {
  const value = String(role || "").trim();
  const compact = value.replace(/[\s_-]+/g, "").toLowerCase();
  if (compact === "superadmin") return "superAdmin";
  if (compact === "frontdesk") return "frontDesk";
  if (compact === "inventorymanager") return "inventoryManager";
  if (compact === "custommarketinglead") return "customMarketingLead";
  if (compact === "marketinglead") return "marketingLead";
  return value;
}

export function staticGrantsForRole(role) {
  return permissions[normalizeRole(role)] || [];
}

export function builtinRoles() {
  return Object.keys(permissions);
}

const writeActionAliases = new Set(["create", "update", "delete", "back", "print", "export"]);

function safeActions(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function actionMatches(actions, action) {
  return actions.includes(action) || actions.includes("*") || actions.includes("admin") || (writeActionAliases.has(action) && actions.includes("write"));
}

function explicitDecision(rows, action) {
  if (!rows.length) return null;
  if (rows.some((row) => row.effect === "deny" && (!row.actions.length || actionMatches(row.actions, action)))) return false;
  if (rows.some((row) => row.effect !== "deny" && actionMatches(row.actions, action))) return true;
  return false;
}

function staticGrantAllows(grants, action, resource) {
  return grants.includes("*") ||
    grants.includes(`${action}:*`) ||
    grants.includes(`${action}:${resource}`) ||
    grants.includes("admin:*") ||
    grants.includes(`admin:${resource}`) ||
    (writeActionAliases.has(action) && (grants.includes("write:*") || grants.includes(`write:${resource}`)));
}

function requestAction(action, req) {
  if (action === "write") {
    if (req.method === "POST") return "create";
    if (req.method === "PATCH" || req.method === "PUT") return "update";
    if (req.method === "DELETE") return "delete";
  }
  if (action === "read" && /(?:^|\/)(?:export|download|csv|pdf)(?:\/|$)/i.test(req.path || req.originalUrl || "")) return "export";
  return action;
}

function auditDenied(req, { action = "", resource = "", reason = "forbidden" } = {}) {
  try {
    const access = req.access || {};
    const tenantId = access.tenantId || req.get?.("x-tenant-id") || "tenant_aura";
    db.prepare(`INSERT INTO security_audit_logs (
      id, tenantId, branchId, actorUserId, actorRole, action, targetType, targetId, severity, ipAddress, userAgent, details, createdAt
    ) VALUES (
      @id, @tenantId, @branchId, @actorUserId, @actorRole, @action, @targetType, @targetId, @severity, @ipAddress, @userAgent, @details, @createdAt
    )`).run({
      id: `audit_${randomUUID().slice(0, 10)}`,
      tenantId,
      branchId: access.branchId || req.get?.("x-branch-id") || "",
      actorUserId: access.userId || "",
      actorRole: access.role || req.user?.role || req.get?.("x-user-role") || "anonymous",
      action: `access.${reason}`,
      targetType: resource || "system",
      targetId: req.params?.id || "",
      severity: "warning",
      ipAddress: req.ip || "",
      userAgent: req.get?.("user-agent") || "",
      details: JSON.stringify({ method: req.method, path: req.originalUrl || req.url, requiredAction: action, resource, reason }),
      createdAt: new Date().toISOString()
    });
  } catch {
    // Permission checks must not fail open because audit logging failed.
  }
}

export function can(role, action, resource, access = {}) {
  role = normalizeRole(role);
  if (cappedBuiltinRoles.has(role)) return staticGrantAllows(permissions[role] || [], action, resource);
  if (staticGrantAllows(access.permissions || [], action, resource)) return true;
  const grants = permissions[role] || [];
  if (grants.includes("*")) return true;
  try {
    const rows = db
      .prepare(`SELECT resource, actions, effect
                  FROM security_permissions
                 WHERE tenantId = @tenantId
                   AND role = @role
                   AND (resource = @resource OR resource = '*')
                   AND status = 'active'`)
      .all({ tenantId: access.tenantId || "", role, resource });
    const parsedRows = rows.map((row) => ({
      resource: row.resource,
      effect: row.effect || "allow",
      actions: safeActions(row.actions)
    }));
    const exactDecision = explicitDecision(parsedRows.filter((row) => row.resource === resource), action);
    if (exactDecision !== null) return exactDecision;
    const wildcardDecision = explicitDecision(parsedRows.filter((row) => row.resource === "*"), action);
    if (wildcardDecision !== null) return wildcardDecision;
  } catch {
    // Fall back to built-in grants when persisted role grants cannot be inspected.
  }
  return staticGrantAllows(grants, action, resource);
}
export function requirePermission(action, resourceResolver = (req) => req.params.resource || "system") {
  return (req, _res, next) => {
    if (!req.access && !req.user) {
      auditDenied(req, { action, resource: "system", reason: "unauthorized" });
      next(unauthorized());
      return;
    }
    const resource = resourceResolver(req);
    const role = req.access?.role || req.user?.role || "staff";
    const checkedAction = requestAction(action, req);
    if (checkedAction === "read" && req.access?.staffId && /^\/staff-self\//.test(req.path || "")) {
      next();
      return;
    }
    if (!can(role, checkedAction, resource, req.access || {})) {
      auditDenied(req, { action: checkedAction, resource, reason: "forbidden" });
      next(forbidden());
      return;
    }
    next();
  };
}


export function requireAnyPermission(checks = []) {
  return (req, _res, next) => {
    if (!req.access && !req.user) {
      auditDenied(req, { action: "any", resource: "system", reason: "unauthorized" });
      next(unauthorized());
      return;
    }
    const role = req.access?.role || req.user?.role || "staff";
    const allowed = checks.some((check) => {
      const action = requestAction(check.action || "read", req);
      const resource = typeof check.resource === "function" ? check.resource(req) : check.resource;
      return can(role, action, resource || "system", req.access || {});
    });
    if (!allowed) {
      auditDenied(req, { action: "any", resource: checks.map((check) => typeof check.resource === "function" ? "dynamic" : check.resource).filter(Boolean).join(",") || "system", reason: "forbidden" });
      next(forbidden());
      return;
    }
    next();
  };
}

