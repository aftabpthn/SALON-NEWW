import { forbidden } from "../utils/app-error.js";
import { db } from "../db.js";

const permissions = {
  superAdmin: ["*"],
  owner: ["*"],
  admin: ["*"],
  manager: [
    "read:*",
    "write:clients",
    "write:appointments",
    "write:services",
    "write:products",
    "write:inventory",
    "write:sales",
    "write:invoices",
    "write:payments",
    "write:appointment_deposits",
    "write:memberships",
    "write:staff",
    "write:marketing",
    "write:analytics",
    "read:analytics",
    "write:ai",
    "read:ai",
    "write:whatsapp",
    "read:whatsapp",
    "write:branches",
    "write:localization",
    "write:notifications",
    "write:smart-booking",
    "read:smart-booking",
    "read:offline",
    "write:offline",
    "read:future-features",
    "write:future-features",
    "read:workflows",
    "write:workflows",
    "read:finance",
    "write:finance",
    "read:customer-360",
    "write:customer-360",
    "read:booking-portal",
    "write:booking-portal",
    "read:quality",
    "write:quality",
    "read:deployment",
    "write:deployment",
    "read:migration",
    "write:migration"
  ],
  receptionist: [
    "read:*",
    "write:clients",
    "write:appointments",
    "write:sales",
    "write:invoices",
    "write:payments",
    "write:appointment_deposits",
    "write:ai",
    "write:whatsapp",
    "read:whatsapp",
    "write:smart-booking",
    "read:smart-booking",
    "write:offline",
    "read:offline",
    "read:finance",
    "read:customer-360",
    "write:customer-360",
    "read:booking-portal",
    "write:booking-portal",
    "write:notifications"
  ],
  frontDesk: [
    "read:*",
    "write:clients",
    "write:appointments",
    "write:sales",
    "write:invoices",
    "write:payments",
    "write:appointment_deposits",
    "write:ai",
    "write:whatsapp",
    "read:whatsapp",
    "write:smart-booking",
    "read:smart-booking",
    "write:offline",
    "read:offline",
    "read:finance",
    "write:finance",
    "read:customer-360",
    "write:customer-360",
    "read:booking-portal",
    "write:booking-portal",
    "write:notifications"
  ],
  cashier: [
    "read:*",
    "write:clients",
    "write:sales",
    "write:invoices",
    "write:payments",
    "read:appointment_deposits",
    "write:whatsapp",
    "read:whatsapp",
    "read:finance",
    "write:finance",
    "read:customer-360",
    "write:customer-360",
    "read:booking-portal",
    "write:notifications"
  ],
  accountant: [
    "read:*",
    "read:finance",
    "write:finance",
    "read:invoices",
    "write:invoices",
    "read:payments",
    "write:payments",
    "read:appointment_deposits",
    "read:reports",
    "read:analytics",
    "read:security",
    "write:security",
    "read:quality",
    "write:quality",
    "read:deployment",
    "write:deployment"
  ],
  inventoryManager: [
    "read:*",
    "read:products",
    "write:products",
    "read:inventory",
    "write:inventory",
    "read:inventory-intelligence",
    "write:inventory-intelligence",
    "read:suppliers",
    "write:suppliers",
    "read:branches",
    "write:branches"
  ],
  staff: [
    "read:appointments",
    "read:clients",
    "read:services",
    "read:products",
    "read:suppliers",
    "read:branches",
    "read:inventory",
    "write:inventory",
    "read:ai",
    "read:whatsapp",
    "write:appointments",
    "write:ai",
    "write:whatsapp",
    "read:smart-booking",
    "read:customer-360",
    "read:booking-portal"
  ],
  analyst: ["read:*", "read:reports", "read:analytics", "write:analytics", "read:ai", "read:whatsapp", "write:ai", "read:security", "read:quality", "read:deployment", "read:future-features", "write:future-features", "read:finance", "read:customer-360", "read:workflows"]
};

export function staticGrantsForRole(role) {
  return permissions[role] || [];
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
export function can(role, action, resource, access = {}) {
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
    const resource = resourceResolver(req);
    const role = req.access?.role || req.user?.role || "staff";
    const checkedAction = requestAction(action, req);
    if (!can(role, checkedAction, resource, req.access || {})) {
      next(forbidden());
      return;
    }
    next();
  };
}


export function requireAnyPermission(checks = []) {
  return (req, _res, next) => {
    const role = req.access?.role || req.user?.role || "staff";
    const allowed = checks.some((check) => {
      const action = requestAction(check.action || "read", req);
      const resource = typeof check.resource === "function" ? check.resource(req) : check.resource;
      return can(role, action, resource || "system", req.access || {});
    });
    if (!allowed) {
      next(forbidden());
      return;
    }
    next();
  };
}

