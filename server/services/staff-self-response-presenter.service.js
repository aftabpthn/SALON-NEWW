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

function rupeesToPaise(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function dashboardMoneyAsPaise(result = {}) {
  return {
    ...result,
    summary: result.summary ? {
      ...result.summary,
      revenue: rupeesToPaise(result.summary.revenue),
      appointmentValue: rupeesToPaise(result.summary.appointmentValue)
    } : result.summary,
    sales: Array.isArray(result.sales) ? result.sales.map((sale) => ({
      ...sale,
      total: rupeesToPaise(sale.total),
      commissionTotal: rupeesToPaise(sale.commissionTotal)
    })) : result.sales
  };
}

function enterpriseMoneyAsPaise(result = {}) {
  const targetProgress = result.home?.targetProgress;
  return {
    ...result,
    home: result.home ? {
      ...result.home,
      expectedRevenue: rupeesToPaise(result.home.expectedRevenue),
      targetProgress: targetProgress ? {
        ...targetProgress,
        targetValue: rupeesToPaise(targetProgress.targetValue),
        achievedValue: rupeesToPaise(targetProgress.achievedValue),
        remaining: rupeesToPaise(targetProgress.remaining)
      } : targetProgress
    } : result.home,
    performance: result.performance ? { ...result.performance, revenue: rupeesToPaise(result.performance.revenue) } : result.performance,
    leaderboard: Array.isArray(result.leaderboard) ? result.leaderboard.map((row) => ({ ...row, revenue: rupeesToPaise(row.revenue) })) : result.leaderboard,
    reports: result.reports ? Object.fromEntries(Object.entries(result.reports).map(([key, report]) => [
      key,
      report && typeof report === "object" ? { ...report, revenue: rupeesToPaise(report.revenue) } : report
    ])) : result.reports
  };
}

export class StaffSelfResponsePresenterService {
  dashboard(result, access) {
    const safeResult = withoutClientData(dashboardMoneyAsPaise(result));
    return hasFinancialAccess(access) ? safeResult : withoutFields(safeResult, isFinancialField);
  }

  enterprise(result, access) {
    const safeResult = withoutClientData(enterpriseMoneyAsPaise(result));
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
