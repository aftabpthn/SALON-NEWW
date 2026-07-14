import { can, normalizeRole } from "../middleware/rbac.js";

const adminRoles = new Set(["owner", "admin", "superAdmin"]);
const financialResources = ["finance", "sales", "payments", "invoices"];
const financialExactFields = new Set(["total", "paid", "sales", "salescount", "appointmentvalue", "aicoach"]);
const privateClientFields = new Set(["notes", "allergies", "medicalnotes", "medicalhistory", "privatenotes", "healthnotes", "birthday", "dateofbirth", "clientprofile", "clientpreferences", "mediaportfolio"]);

function normalizedField(field) {
  return String(field || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function grants(access, action, resource) {
  const permissions = access?.permissions || [];
  return permissions.includes("*") ||
    permissions.includes(`${action}:*`) ||
    permissions.includes(`${action}:${resource}`) ||
    permissions.includes(`write:${resource}`) ||
    permissions.includes(`admin:${resource}`);
}

function hasFinancialAccess(access = {}) {
  const role = normalizeRole(access.role || "staff");
  if (adminRoles.has(role)) return true;
  return financialResources.some((resource) =>
    grants(access, "read", resource) ||
    can(role, "read", resource, access) ||
    can(role, "write", resource, access)
  );
}

function withoutFields(value, restricted) {
  if (Array.isArray(value)) return value.map((item) => withoutFields(item, restricted));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([field]) => !restricted(field))
      .map(([field, child]) => [field, withoutFields(child, restricted)])
  );
}

function isFinancialField(field) {
  const normalized = normalizedField(field);
  return financialExactFields.has(normalized) ||
    /(revenue|payment|invoice|amount|balance|commission|spend|price|wallet)/.test(normalized) ||
    ["targetprogress", "targetvalue", "achievedvalue", "remaining"].includes(normalized);
}

function isPrivateClientField(field) {
  const normalized = normalizedField(field);
  return normalized.includes("client") || normalized.includes("customer") || privateClientFields.has(normalized);
}

function withoutClientData(result) {
  return withoutFields(result, isPrivateClientField);
}

export class StaffSelfResponsePresenterService {
  dashboard(result, access) {
    const safeResult = withoutClientData(result);
    return hasFinancialAccess(access) ? safeResult : withoutFields(safeResult, isFinancialField);
  }

  enterprise(result, access) {
    const safeResult = withoutClientData(result);
    return hasFinancialAccess(access) ? safeResult : withoutFields(safeResult, isFinancialField);
  }

  staffData(result, access) {
    const safeResult = withoutClientData(result);
    return hasFinancialAccess(access) ? safeResult : withoutFields(safeResult, isFinancialField);
  }

  invoiceDetail(result) {
    return withoutFields(result, (field) => {
      const normalized = normalizedField(field);
      return normalized !== "clientname" && (isPrivateClientField(field) || normalized === "reference");
    });
  }
}

export const staffSelfResponsePresenterService = new StaffSelfResponsePresenterService();
