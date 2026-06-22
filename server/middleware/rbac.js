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

export function can(role, action, resource, access = {}) {
  const grants = permissions[role] || [];
  if (grants.includes("*") || grants.includes(`${action}:*`) || grants.includes(`${action}:${resource}`)) return true;
  try {
    const rows = db
      .prepare("SELECT actions, effect FROM security_permissions WHERE tenantId = ? AND role = ? AND (resource = ? OR resource = '*') AND status = 'active'")
      .all(access.tenantId || "", role, resource);
    const parsedRows = rows.map((row) => ({
      effect: row.effect,
      actions: JSON.parse(row.actions || "[]")
    }));
    const matches = (row) => row.actions.includes(action) || row.actions.includes("*") || row.actions.includes("admin");
    if (parsedRows.some((row) => row.effect === "deny" && matches(row))) return false;
    return parsedRows.some((row) => {
      if (row.effect === "deny") return false;
      return matches(row);
    });
  } catch {
    return false;
  }
}

export function requirePermission(action, resourceResolver = (req) => req.params.resource || "system") {
  return (req, _res, next) => {
    const resource = resourceResolver(req);
    const role = req.access?.role || req.user?.role || "staff";
    if (!can(role, action, resource, req.access || {})) {
      next(forbidden());
      return;
    }
    next();
  };
}
