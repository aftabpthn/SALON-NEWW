import { roleDiscountLimits } from "../config/role-discount-limits.js";

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function percent(value) {
  return Math.min(100, Math.max(0, Number(value || 0) || 0));
}

export function normalizeApprovalRole(role = "") {
  const value = String(role || "").trim();
  const map = {
    branchManager: "branch_manager",
    branch_manager: "branch_manager",
    manager: "branch_manager",
    regionalHead: "regional_head",
    regional_head: "regional_head",
    frontDesk: "receptionist",
    superAdmin: "owner"
  };
  return map[value] || value || "cashier";
}

export function extractMaxDiscountPercent(rule = {}) {
  const action = parseJson(rule.actionJson ?? rule.action, {});
  const actions = Array.isArray(action) ? action : [action];

  return actions.reduce((maxPercent, current = {}) => {
    if (current.maxDiscountPercent !== undefined) return Math.max(maxPercent, percent(current.maxDiscountPercent));
    if (current.percentOff !== undefined) return Math.max(maxPercent, percent(current.percentOff));
    if (current.type === "percent") return Math.max(maxPercent, percent(current.value));
    if (current.type === "flat" || current.type === "bundle_price") return Math.max(maxPercent, 100);
    return maxPercent;
  }, 0);
}

export function checkApprovalNeeded({ role = "", rule = {}, requestedStatus = "" } = {}) {
  const normalizedRole = normalizeApprovalRole(role);
  const roleLimitPercent = roleDiscountLimits[normalizedRole] ?? 0;
  const requestedPercent = extractMaxDiscountPercent(rule);
  const wantsActive = requestedStatus === "active" || rule.status === "active";

  return {
    approvalNeeded: wantsActive && requestedPercent > roleLimitPercent,
    requestedPercent,
    roleLimitPercent,
    role: normalizedRole,
    reason: requestedPercent > roleLimitPercent ? "role_discount_limit_exceeded" : "within_role_limit"
  };
}
