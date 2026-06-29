import { db } from "../db.js";
import { forbidden } from "../utils/app-error.js";
import { tenantService } from "./tenant.service.js";

const payrollRoles = new Set(["owner", "admin", "superAdmin", "accountant"]);
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

function requirePayrollAccess(access = {}) {
  if (!access.tenantId) throw forbidden("Tenant context is required");
  if (!payrollRoles.has(access.role)) throw forbidden("Payroll history is restricted");
}

function parseJson(value, fallback = {}) {
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function datePart(value = "") {
  return String(value || "").slice(0, 10);
}

function timePart(value = "") {
  const text = String(value || "");
  return text.length > 10 ? text.slice(11, 16) : "";
}

function daysBetween(from = "", to = today()) {
  if (!from) return 0;
  const start = new Date(`${datePart(from)}T00:00:00.000Z`);
  const end = new Date(`${datePart(to)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function rowToHistory(row = {}) {
  const statutory = parseJson(row.statutory_json, {});
  const preview = statutory.preview || {};
  const staffName = row.staff_name || row.legacy_staff_name || row.staff_id || "Unassigned";
  return {
    payrollRunId: row.payroll_run_id || "",
    payrollItemId: row.payroll_item_id || "",
    periodStart: row.period_start || "",
    periodEnd: row.period_end || "",
    generatedDate: datePart(row.run_created_at),
    generatedTime: timePart(row.run_created_at),
    approvedAt: row.approved_at || "",
    paidAt: row.paid_at || "",
    status: row.item_status || row.run_status || "draft",
    runStatus: row.run_status || "draft",
    branchId: row.branch_id || "",
    branchName: row.branch_name || row.branch_id || "-",
    staffId: row.staff_id || "",
    staffName,
    staffCode: row.employee_code || row.staff_id || "",
    staffContact: row.mobile || "",
    grossAmount: money(row.item_gross_amount),
    deductionAmount: money(row.item_deduction_amount),
    netAmount: money(row.item_net_amount),
    overtimeAmount: money(row.overtime_amount || statutory.overtimeAmount || preview.otAmount),
    bonusAmount: money(row.bonus_amount || statutory.bonusAmount || preview.totalCommission),
    pf: money(statutory.pf),
    esic: money(statutory.esic),
    tds: money(statutory.tds),
    professionalTax: money(statutory.professionalTax),
    paymentMode: statutory.profilePaymentMode || preview.paymentMode || "-",
    bankName: statutory.profileBankName || preview.bankName || "-",
    salarySource: statutory.salarySource || "-",
    generatedFromPreview: Boolean(statutory.generatedFromPreview),
    createdBy: row.created_by || "-",
    approvedBy: row.approved_by || "-",
    pendingDays: row.run_status === "paid" ? 0 : daysBetween(row.period_end || row.run_created_at),
    action: "Open payroll run"
  };
}

function summary(rows = []) {
  const runs = new Set(rows.map((row) => row.payrollRunId).filter(Boolean));
  const staff = new Set(rows.map((row) => row.staffId).filter(Boolean));
  return rows.reduce((acc, row) => {
    acc.payrollRuns = runs.size;
    acc.payrollRows = rows.length;
    acc.staffPaid = staff.size;
    acc.grossAmount = money(acc.grossAmount + Number(row.grossAmount || 0));
    acc.deductionAmount = money(acc.deductionAmount + Number(row.deductionAmount || 0));
    acc.netAmount = money(acc.netAmount + Number(row.netAmount || 0));
    acc.overtimeAmount = money(acc.overtimeAmount + Number(row.overtimeAmount || 0));
    acc.bonusAmount = money(acc.bonusAmount + Number(row.bonusAmount || 0));
    if (row.status === "draft") acc.draftRows += 1;
    if (row.status === "approved") acc.approvedRows += 1;
    if (row.status === "paid") {
      acc.paidRows += 1;
      acc.paidAmount = money(acc.paidAmount + Number(row.netAmount || 0));
    } else {
      acc.pendingAmount = money(acc.pendingAmount + Number(row.netAmount || 0));
    }
    return acc;
  }, {
    payrollRuns: 0,
    payrollRows: 0,
    staffPaid: 0,
    grossAmount: 0,
    deductionAmount: 0,
    netAmount: 0,
    overtimeAmount: 0,
    bonusAmount: 0,
    paidAmount: 0,
    pendingAmount: 0,
    draftRows: 0,
    approvedRows: 0,
    paidRows: 0
  });
}

class StaffPayrollHistoryReportService {
  report(query = {}, access = {}) {
    requirePayrollAccess(access);
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const params = {
      tenantId: access.tenantId,
      branchId,
      status: query.status || "",
      staffId: query.staffId || query.staff_id || "",
      from: query.from || query.periodStart || query.dateFrom || "",
      to: query.to || query.periodEnd || query.dateTo || "",
      q: String(query.q || query.query || "").trim().toLowerCase(),
      limit: Math.min(Math.max(Number(query.limit || 500), 1), 1000)
    };
    const filters = ["r.tenant_id = @tenantId"];
    if (params.branchId) filters.push("r.branch_id = @branchId");
    if (params.status) filters.push("COALESCE(i.status, r.status) = @status");
    if (params.staffId) filters.push("i.staff_id = @staffId");
    if (params.from) filters.push("r.period_end >= @from");
    if (params.to) filters.push("r.period_start <= @to");
    if (params.q) {
      filters.push(`(
        LOWER(COALESCE(sm.full_name, '')) LIKE '%' || @q || '%' OR
        LOWER(COALESCE(sm.employee_code, '')) LIKE '%' || @q || '%' OR
        LOWER(COALESCE(sm.mobile, '')) LIKE '%' || @q || '%' OR
        LOWER(COALESCE(r.id, '')) LIKE '%' || @q || '%' OR
        LOWER(COALESCE(i.staff_id, '')) LIKE '%' || @q || '%'
      )`);
    }
    const rows = db.prepare(`
      SELECT
        r.id AS payroll_run_id,
        r.branch_id,
        r.period_start,
        r.period_end,
        r.status AS run_status,
        r.gross_amount AS run_gross_amount,
        r.deductions_amount AS run_deductions_amount,
        r.net_amount AS run_net_amount,
        r.approved_by,
        r.approved_at,
        r.paid_at,
        r.created_by,
        r.created_at AS run_created_at,
        i.id AS payroll_item_id,
        i.staff_id,
        i.gross_amount AS item_gross_amount,
        i.overtime_amount,
        i.bonus_amount,
        i.deduction_amount AS item_deduction_amount,
        i.net_amount AS item_net_amount,
        i.statutory_json,
        i.status AS item_status,
        sm.full_name AS staff_name,
        sm.employee_code,
        sm.mobile,
        b.name AS branch_name
      FROM staff_payroll_runs r
      LEFT JOIN staff_payroll_items i
        ON i.tenant_id = r.tenant_id AND i.payroll_run_id = r.id
      LEFT JOIN staff_master sm
        ON sm.tenant_id = r.tenant_id AND sm.id = i.staff_id
      LEFT JOIN branches b
        ON b.id = r.branch_id
      WHERE ${filters.join(" AND ")}
      ORDER BY r.created_at DESC, i.staff_id ASC
      LIMIT @limit
    `).all(params).map(rowToHistory);
    return {
      filters: {
        branchId: params.branchId,
        status: params.status,
        staffId: params.staffId,
        from: params.from,
        to: params.to,
        q: params.q
      },
      summary: summary(rows),
      rows
    };
  }
}

export const staffPayrollHistoryReportService = new StaffPayrollHistoryReportService();
