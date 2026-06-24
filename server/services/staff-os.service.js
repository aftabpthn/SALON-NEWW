import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, db } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/app-error.js";
import { jobQueueService } from "./job-queue.service.js";
import { realtimeService } from "./realtime.service.js";
import { securityService } from "./security.service.js";
import { staffLoginService } from "./staff-login.service.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const businessDate = () => now().slice(0, 10);
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;

const managerRoles = new Set(["owner", "admin", "superAdmin", "manager"]);
const payrollRoles = new Set(["owner", "admin", "superAdmin", "accountant"]);
const commissionRoles = new Set(["owner", "admin", "superAdmin"]);
const attendanceCorrectionRoles = new Set(["owner", "admin", "superAdmin", "manager"]);
const staffCategoryScopes = new Set(["operator", "helper", "admin", "staff", "contract_operator"]);
const attendanceLateMarkModes = new Set(["every_x_late", "all_after_x_late"]);
const targetIncentiveTypes = new Set(["service", "product", "membership", "branch_admin", "admin", "all_transaction"]);
const targetAssigneeTypes = new Set(["staff", "branch", "standard"]);
const allowanceDeductionTypes = new Set(["allowance", "deduction"]);
const finePenaltyRuleTypes = new Set(["manual", "late_count", "absent_day", "half_day", "short_hours", "no_clock_out", "weekend_penalty", "sandwich_penalty", "unpaid_week_off"]);
const finePenaltyApplyModes = new Set(["per_occurrence", "fixed"]);
const MAX_STAFF_MEDIA_BYTES = 5 * 1024 * 1024;
const STAFF_MEDIA_MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
  ["image/bmp", ".bmp"],
  ["image/tiff", ".tiff"]
]);
const STAFF_MEDIA_EXTENSIONS = new Set([...STAFF_MEDIA_MIME_EXTENSIONS.values(), ".jpeg"]);

function normalizeAccess(access = {}) {
  if (!access.tenantId) throw forbidden("Tenant context is required");
  return access;
}

function pickBranch(payload = {}, access = {}) {
  return payload.branchId || payload.branch_id || access.requestedBranchId || access.branchId || "";
}

function assertBranch(access, branchId) {
  if (!branchId) throw badRequest("branchId is required");
  tenantService.assertBranchAccess(access, branchId);
}

function branchScopedWhere(access, params, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const filters = [`${prefix}tenant_id = @tenant_id`];
  if (params.branch_id) filters.push(`${prefix}branch_id = @branch_id`);
  if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
    filters.push(`${prefix}branch_id = @access_branch_id`);
    params.access_branch_id = access.branchId;
  }
  return filters.join(" AND ");
}

function requireRole(access, allowed, message = "This action is not allowed for your role") {
  if (!allowed.has(access.role)) throw forbidden(message);
}

function requireManager(access) {
  requireRole(access, managerRoles, "Only manager/admin/owner can manage Staff OS records");
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function boolInt(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "yes" ? 1 : 0;
}

function hashStaffPin(value) {
  const pin = String(value || "").trim();
  if (!pin) return null;
  const salt = randomBytes(16).toString("hex");
  return {
    salt,
    hash: createHash("sha256").update(`${salt}:${pin}`).digest("hex")
  };
}

function normalizeStaffCategoryScope(value = "staff") {
  const normalized = String(value || "staff").trim().replace(/[\s-]+/g, "_").toLowerCase();
  const aliases = {
    oprs: "operator",
    operator: "operator",
    helper: "helper",
    admin: "admin",
    staff: "staff",
    cont_opr: "contract_operator",
    cont_oprs: "contract_operator",
    contract: "contract_operator",
    contract_operator: "contract_operator"
  };
  const scope = aliases[normalized] || normalized;
  if (!staffCategoryScopes.has(scope)) throw badRequest("Invalid staff category scope");
  return scope;
}

function normalizeQuotaPeriod(value = "yearly") {
  const normalized = String(value || "yearly").trim().toLowerCase();
  if (!["monthly", "yearly"].includes(normalized)) throw badRequest("Invalid leave quota period");
  return normalized;
}

function normalizeShiftType(value = "regular") {
  const normalized = String(value || "regular").trim().replace(/[\s-]+/g, "_").toLowerCase();
  const aliases = {
    regular: "regular",
    weekly_off: "weekly_off",
    weekoff: "weekly_off",
    holiday: "holiday",
    leave: "leave"
  };
  const type = aliases[normalized] || normalized;
  if (!["regular", "weekly_off", "holiday", "leave"].includes(type)) throw badRequest("Invalid shift type");
  return type;
}

function normalizeAttendanceLateMarkMode(value = "every_x_late") {
  const normalized = String(value || "every_x_late").trim().replace(/[\s-]+/g, "_").toLowerCase();
  const mode = normalized === "all_late_coming_after_x" ? "all_after_x_late" : normalized;
  if (!attendanceLateMarkModes.has(mode)) throw badRequest("Invalid attendance late mark mode");
  return mode;
}

function normalizeTargetIncentiveType(value = "service") {
  const normalized = String(value || "service").trim().replace(/[\s-]+/g, "_").toLowerCase();
  const aliases = {
    all_tr: "all_transaction",
    all_transactions: "all_transaction",
    branch_admin: "branch_admin",
    branch_admin_service: "branch_admin"
  };
  const type = aliases[normalized] || normalized;
  if (!targetIncentiveTypes.has(type)) throw badRequest("Invalid target incentive type");
  return type;
}

function normalizeTargetAssigneeType(value = "staff") {
  const normalized = String(value || "staff").trim().replace(/[\s-]+/g, "_").toLowerCase();
  if (!targetAssigneeTypes.has(normalized)) throw badRequest("Invalid target incentive assignee type");
  return normalized;
}

function normalizeTargetRoleScope(value = "operator") {
  const normalized = String(value || "operator").trim().replace(/[\s-]+/g, "_").toLowerCase();
  const aliases = { operators: "operator", oprs: "operator", admins: "admin", all: "all" };
  const roleScope = aliases[normalized] || normalized;
  if (!["operator", "admin", "all"].includes(roleScope)) throw badRequest("Invalid target role scope");
  return roleScope;
}

function normalizeAllowanceDeductionType(value = "allowance") {
  const normalized = String(value || "allowance").trim().replace(/[\s-]+/g, "_").toLowerCase();
  const entryType = normalized === "deductions" ? "deduction" : normalized === "allowances" ? "allowance" : normalized;
  if (!allowanceDeductionTypes.has(entryType)) throw badRequest("Invalid allowance/deduction type");
  return entryType;
}

function normalizeFinePenaltyRuleType(value = "manual") {
  const normalized = String(value || "manual").trim().replace(/[\s-]+/g, "_").toLowerCase();
  const aliases = {
    late: "late_count",
    absent: "absent_day",
    half: "half_day",
    short_hour: "short_hours",
    missing_clock_out: "no_clock_out",
    weekoff: "unpaid_week_off"
  };
  const ruleType = aliases[normalized] || normalized;
  if (!finePenaltyRuleTypes.has(ruleType)) throw badRequest("Invalid fine/penalty rule type");
  return ruleType;
}

function normalizeFinePenaltyApplyMode(value = "per_occurrence") {
  const normalized = String(value || "per_occurrence").trim().replace(/[\s-]+/g, "_").toLowerCase();
  const mode = normalized === "one_time" ? "fixed" : normalized;
  if (!finePenaltyApplyModes.has(mode)) throw badRequest("Invalid fine/penalty apply mode");
  return mode;
}

function deriveCode(value = "", fallbackPrefix = "ST") {
  const compact = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return (compact || `${fallbackPrefix}${Date.now().toString().slice(-4)}`).slice(0, 12);
}

function safePathSegment(value, fallback) {
  const segment = String(value || fallback || "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
  return segment || fallback;
}

function mediaExtension(payload = {}) {
  const mimeType = String(payload.mimeType || "").toLowerCase();
  const nameMatch = String(payload.fileName || "").toLowerCase().match(/\.(jpe?g|png|webp|gif|avif|hei[cf]|bmp|tiff?)$/);
  const rawExtension = nameMatch?.[1] || "";
  const normalizedExtension = rawExtension === "jpeg" ? "jpg" : rawExtension === "tif" ? "tiff" : rawExtension;
  const extension = normalizedExtension ? `.${normalizedExtension}` : "";
  if (extension && STAFF_MEDIA_EXTENSIONS.has(extension)) return extension;
  return STAFF_MEDIA_MIME_EXTENSIONS.get(mimeType) || "";
}

function imageSignatureMatches(buffer, mimeType) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mimeType === "image/gif") return buffer.subarray(0, 3).toString("ascii") === "GIF";
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "image/bmp") return buffer.subarray(0, 2).toString("ascii") === "BM";
  if (mimeType === "image/tiff") {
    const head = buffer.subarray(0, 4);
    return head.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || head.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]));
  }
  if (["image/avif", "image/heic", "image/heif"].includes(mimeType)) {
    const brand = buffer.subarray(4, 16).toString("ascii");
    return brand.includes("ftyp") && /avif|heic|heif|mif1|msf1/.test(brand);
  }
  return false;
}

function rowToStaff(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    mobile: row.mobile,
    email: row.email,
    gender: row.gender,
    dob: row.dob,
    profilePhoto: row.profile_photo,
    joiningDate: row.joining_date,
    employmentType: row.employment_type,
    status: row.status,
    roleId: row.role_id,
    staffCategoryId: row.staff_category_id || "",
    staffCategoryName: row.staff_category_name || "",
    staffCategoryScope: row.staff_category_scope || "",
    loginUserId: row.login_user_id || "",
    loginId: row.login_id || "",
    loginEmail: row.login_email || "",
    loginStatus: row.login_status || "",
    loginPasswordSet: Number(row.login_password_set || 0) === 1,
    department: row.department,
    designation: row.designation,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactMobile: row.emergency_contact_mobile,
    address: row.address,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    notes: row.notes,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToStaffCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    name: row.name,
    scope: row.scope,
    department: row.department,
    defaultDesignation: row.default_designation,
    defaultEmploymentType: row.default_employment_type,
    fixedIncentiveAmount: Number(row.fixed_incentive_amount || 0),
    fixedIncentivePercent: Number(row.fixed_incentive_percent || 0),
    serviceEligibility: parseJsonArray(row.service_eligibility_json),
    skillLicenses: parseJsonArray(row.skill_license_json),
    notes: row.notes,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToEmployeeDetails(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    staffId: row.staff_id,
    shortName: row.short_name || "",
    lastWorkingDate: row.last_working_date || "",
    anniversaryDate: row.anniversary_date || "",
    hideFromRoster: Number(row.hide_from_roster || 0) === 1,
    allowSkipOtp: Number(row.allow_skip_otp || 0) === 1,
    entryPinSet: Number(row.entry_pin_set || 0) === 1,
    multiBranchAccess: parseJsonArray(row.multi_branch_access_json),
    contact: parseJsonObject(row.contact_json),
    emergencyContact: parseJsonObject(row.emergency_contact_json),
    nativeContact: parseJsonObject(row.native_contact_json),
    incentive: parseJsonObject(row.incentive_json),
    attendanceSalary: parseJsonObject(row.attendance_salary_json),
    remarks: row.remarks || "",
    imeiNo: row.imei_no || "",
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToAttendanceStatusMaster(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    dayCount: Number(row.day_count || 0),
    paid: Number(row.paid || 0) === 1,
    availableForAppointment: Number(row.available_for_appointment || 0) === 1,
    hide: Number(row.hide || 0) === 1,
    color: row.color || "#0f766e",
    sortOrder: Number(row.sort_order || 0),
    notes: row.notes || "",
    status: row.status || "active",
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToLeaveTypeMaster(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    dayCount: Number(row.day_count || 0),
    paid: Number(row.paid || 0) === 1,
    availableForAppointment: Number(row.available_for_appointment || 0) === 1,
    leaveQuota: Number(row.leave_quota || 0),
    quotaPeriod: row.quota_period || "yearly",
    shiftTemplateId: row.shift_template_id || "",
    shiftName: row.shift_name || "",
    carryForwardAllowed: Number(row.carry_forward_allowed || 0) === 1,
    approvalRequired: Number(row.approval_required || 0) === 1,
    hide: Number(row.hide || 0) === 1,
    notes: row.notes || "",
    status: row.status || "active",
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToShiftTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    name: row.name,
    shortCode: row.short_code || "",
    description: row.description || "",
    startTime: row.start_time || "",
    endTime: row.end_time || "",
    breakMinutes: Number(row.break_minutes || 0),
    color: row.color || "#bbf7d0",
    shiftType: row.shift_type || "regular",
    hide: Number(row.hide || 0) === 1,
    status: row.status || "active",
    version: row.version || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToAttendanceCategoryMaster(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    name: row.name,
    workingDurationMinutes: Number(row.working_duration_minutes || 0),
    inTime: row.in_time || "",
    outTime: row.out_time || "",
    overtimeApplicable: Number(row.overtime_applicable || 0) === 1,
    minimumOtDurationMinutes: Number(row.minimum_ot_duration_minutes || 0),
    allowableLateMinutes: Number(row.allowable_late_minutes || 0),
    lateMarkStatusId: row.late_mark_status_id || "",
    lateMarkAfterCount: Number(row.late_mark_after_count || 0),
    lateMarkMode: row.late_mark_mode || "every_x_late",
    severeLateStatusId: row.severe_late_status_id || "",
    severeLateAfterMinutes: Number(row.severe_late_after_minutes || 0),
    attendanceSlabs: parseJsonArray(row.attendance_slab_json),
    allowableShiftIds: parseJsonArray(row.allowable_shift_ids_json),
    hide: Number(row.hide || 0) === 1,
    notes: row.notes || "",
    status: row.status || "active",
    version: row.version || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTargetIncentiveMaster(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    targetType: row.target_type,
    assigneeType: row.assignee_type || "staff",
    assigneeId: row.assignee_id || "",
    assigneeName: row.assignee_name || "",
    roleScope: row.role_scope || "operator",
    slabs: parseJsonArray(row.slabs_json),
    notes: row.notes || "",
    hide: Number(row.hide || 0) === 1,
    status: row.status || "active",
    version: row.version || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToServiceAssignmentMaster(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    staffId: row.staff_id,
    staffName: row.staff_name || "",
    roleScope: row.role_scope || "operator",
    serviceIds: parseJsonArray(row.service_ids_json),
    services: parseJsonArray(row.service_snapshot_json),
    categoryFilters: parseJsonArray(row.category_filter_json),
    hide: Number(row.hide || 0) === 1,
    notes: row.notes || "",
    status: row.status || "active",
    version: row.version || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToFinePenaltyMaster(row) {
  if (!row) return null;
  const amountPaise = Number(row.amount_paise ?? Math.round(Number(row.amount || 0) * 100));
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    name: row.name,
    amount: amountPaise ? amountPaise / 100 : Number(row.amount || 0),
    amountPaise,
    ruleType: row.rule_type || "manual",
    ruleLabel: row.rule_label || "",
    triggerCount: Number(row.trigger_count || 1),
    applyMode: row.apply_mode || "per_occurrence",
    autoDeduct: Number(row.auto_deduct ?? 1) === 1,
    hide: Number(row.hide || 0) === 1,
    notes: row.notes || "",
    status: row.status || "active",
    version: row.version || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToAllowanceDeductionMaster(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    description: row.description,
    entryType: row.entry_type || "allowance",
    hide: Number(row.hide || 0) === 1,
    notes: row.notes || "",
    status: row.status || "active",
    version: row.version || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToPayrollSalaryStructureMaster(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    name: row.name || "Default Payroll Salary Structure",
    providentFund: parseJsonObject(row.provident_fund_json),
    professionalTax: parseJsonObject(row.professional_tax_json),
    esic: parseJsonObject(row.esic_json),
    tds: parseJsonObject(row.tds_json),
    hide: Number(row.hide || 0) === 1,
    notes: row.notes || "",
    status: row.status || "active",
    version: row.version || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToBulkEmployeeUpdateJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    totalRows: Number(row.total_rows || 0),
    updatedRows: Number(row.updated_rows || 0),
    failedRows: Number(row.failed_rows || 0),
    results: parseJsonArray(row.results_json),
    requestedBy: row.requested_by || "",
    status: row.status || "completed",
    createdAt: row.created_at
  };
}

function sanitizeEmployeeDetailsForAudit(row) {
  if (!row) return null;
  const details = rowToEmployeeDetails(row);
  return details ? { ...details, entryPinSet: Number(row.entry_pin_set || 0) === 1 } : null;
}

function rowToCamel(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    value
  ]));
}

function firstStaffEmail(staff = {}) {
  return [staff.email, staff.loginEmail]
    .map((value) => String(value || "").trim())
    .find((value) => value.includes("@")) || "";
}

function firstStaffPhone(staff = {}) {
  return [staff.mobile, staff.phone, staff.whatsapp, staff.whatsappNumber]
    .map((value) => String(value || "").trim())
    .find((value) => value.replace(/\D/g, "").length >= 7) || "";
}

function formatRosterDate(value = "") {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value || "");
}

function rosterNotificationCopy(schedule = {}, staff = {}) {
  const staffName = staff.fullName || staff.firstName || "Staff";
  const timing = `${schedule.startTime || ""} - ${schedule.endTime || ""}`.trim();
  const dateLabel = formatRosterDate(schedule.scheduleDate);
  const branchLabel = schedule.branchId || "your salon";
  return {
    subject: `Roster shift assigned: ${dateLabel} ${timing}`.trim(),
    body: `Hi ${staffName}, your roster shift is scheduled for ${dateLabel}, ${timing} at ${branchLabel}. Please report on time.`
  };
}

function formatRupees(value = 0) {
  return Math.round(parseNumber(value, 0)).toLocaleString("en-IN");
}

function penaltyNotificationCopy(run = {}, staff = {}, row = {}) {
  const staffName = staff.fullName || staff.firstName || row.staffName || "Staff";
  const period = `${formatRosterDate(run.periodStart || row.periodStart || "")} - ${formatRosterDate(run.periodEnd || row.periodEnd || "")}`;
  const breakdown = Array.isArray(row.rulePenaltyBreakdown) ? row.rulePenaltyBreakdown : [];
  const ruleText = breakdown.length
    ? breakdown.map((item) => `${item.ruleName || "Penalty rule"} (${item.evidence || `${item.breakCount || 1} break`})`).join(", ")
    : "Penalty rule break";
  const amount = breakdown.reduce((total, item) => total + parseNumber(item.amount, 0), 0) || parseNumber(row.rulePenalty, 0);
  return {
    amount,
    body: `Hi ${staffName}, penalty applied for ${period}: ${ruleText}. Penalty amount Rs ${formatRupees(amount)} will be deducted in payroll. Contact manager if this looks incorrect.`
  };
}

function daysBetweenInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function dateRangeInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate || startDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [startDate];
  const dates = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function leaveBalancePeriod(startDate, quotaPeriod = "yearly") {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { start: startDate, end: startDate };
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (quotaPeriod === "monthly") {
    return {
      start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
      end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)
    };
  }
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`
  };
}

function buildStaffPayload(payload = {}, access) {
  const branchId = pickBranch(payload, access);
  assertBranch(access, branchId);
  const firstName = String(payload.firstName || payload.first_name || "").trim();
  const lastName = String(payload.lastName || payload.last_name || "").trim();
  const fullName = String(payload.fullName || payload.full_name || `${firstName} ${lastName}`.trim()).trim();
  if (!firstName && !fullName) throw badRequest("firstName or fullName is required");
  return {
    id: payload.id || makeId("staffos"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    employee_code: payload.employeeCode || payload.employee_code || "",
    first_name: firstName || fullName.split(/\s+/)[0] || "Staff",
    last_name: lastName || fullName.split(/\s+/).slice(1).join(" "),
    full_name: fullName || firstName,
    mobile: payload.mobile || payload.phone || "",
    email: payload.email || "",
    gender: payload.gender || "",
    dob: payload.dob || "",
    profile_photo: payload.profilePhoto || payload.profile_photo || "",
    joining_date: payload.joiningDate || payload.joining_date || businessDate(),
    employment_type: payload.employmentType || payload.employment_type || "full_time",
    status: payload.status || "active",
    role_id: payload.roleId || payload.role_id || "",
    department: payload.department || "",
    designation: payload.designation || "",
    emergency_contact_name: payload.emergencyContactName || payload.emergency_contact_name || "",
    emergency_contact_mobile: payload.emergencyContactMobile || payload.emergency_contact_mobile || "",
    address: payload.address || "",
    city: payload.city || "",
    state: payload.state || "",
    pincode: payload.pincode || "",
    notes: payload.notes || "",
    version: 1,
    created_at: now(),
    updated_at: now()
  };
}

function buildStaffCategoryPayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  const name = String(payload.name ?? existing?.name ?? "").trim();
  if (!name) throw badRequest("Category name is required");
  return {
    id: existing?.id || payload.id || makeId("scat"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    name,
    scope: normalizeStaffCategoryScope(payload.scope ?? existing?.scope ?? "staff"),
    department: payload.department ?? existing?.department ?? "",
    default_designation: payload.defaultDesignation ?? payload.default_designation ?? existing?.default_designation ?? "",
    default_employment_type: payload.defaultEmploymentType ?? payload.default_employment_type ?? existing?.default_employment_type ?? "full_time",
    fixed_incentive_amount: parseNumber(payload.fixedIncentiveAmount ?? payload.fixed_incentive_amount ?? existing?.fixed_incentive_amount, 0),
    fixed_incentive_percent: parseNumber(payload.fixedIncentivePercent ?? payload.fixed_incentive_percent ?? existing?.fixed_incentive_percent, 0),
    service_eligibility_json: json(payload.serviceEligibility ?? payload.service_eligibility ?? parseJsonArray(existing?.service_eligibility_json)),
    skill_license_json: json(payload.skillLicenses ?? payload.skillLicenseRequirements ?? payload.skill_license ?? parseJsonArray(existing?.skill_license_json)),
    notes: payload.notes ?? existing?.notes ?? "",
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function buildAttendanceStatusMasterPayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  const name = String(payload.name ?? existing?.name ?? "").trim();
  if (!name) throw badRequest("Attendance name is required");
  return {
    id: existing?.id || payload.id || makeId("attmst"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    code: existing?.code || deriveCode(payload.code ?? payload.shortCode ?? payload.short_code ?? name, "AT"),
    name,
    day_count: parseNumber(payload.dayCount ?? payload.day_count ?? existing?.day_count, 1),
    paid: payload.paid !== undefined || payload.isPaid !== undefined ? boolInt(payload.paid ?? payload.isPaid) : Number(existing?.paid ?? 1),
    available_for_appointment: payload.availableForAppointment !== undefined || payload.available_for_appointment !== undefined
      ? boolInt(payload.availableForAppointment ?? payload.available_for_appointment)
      : Number(existing?.available_for_appointment ?? 0),
    hide: payload.hide !== undefined ? boolInt(payload.hide) : Number(existing?.hide ?? 0),
    color: payload.color ?? existing?.color ?? "#0f766e",
    sort_order: parseNumber(payload.sortOrder ?? payload.sort_order ?? existing?.sort_order, 0),
    notes: payload.notes ?? existing?.notes ?? "",
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function buildLeaveTypeMasterPayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  const name = String(payload.name ?? existing?.name ?? "").trim();
  if (!name) throw badRequest("Leave name is required");
  return {
    id: existing?.id || payload.id || makeId("lvmst"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    code: existing?.code || deriveCode(payload.code ?? payload.shortCode ?? payload.short_code ?? name, "LV"),
    name,
    day_count: parseNumber(payload.dayCount ?? payload.day_count ?? existing?.day_count, 1),
    paid: payload.paid !== undefined || payload.isPaid !== undefined ? boolInt(payload.paid ?? payload.isPaid) : Number(existing?.paid ?? 1),
    available_for_appointment: payload.availableForAppointment !== undefined || payload.available_for_appointment !== undefined
      ? boolInt(payload.availableForAppointment ?? payload.available_for_appointment)
      : Number(existing?.available_for_appointment ?? 0),
    leave_quota: parseNumber(payload.leaveQuota ?? payload.noOfLeave ?? payload.leave_quota ?? existing?.leave_quota, 0),
    quota_period: normalizeQuotaPeriod(payload.quotaPeriod ?? payload.quota_period ?? existing?.quota_period ?? "yearly"),
    shift_template_id: payload.shiftTemplateId ?? payload.shift_template_id ?? existing?.shift_template_id ?? "",
    shift_name: payload.shiftName ?? payload.shift_name ?? existing?.shift_name ?? "",
    carry_forward_allowed: payload.carryForwardAllowed !== undefined || payload.carry_forward_allowed !== undefined
      ? boolInt(payload.carryForwardAllowed ?? payload.carry_forward_allowed)
      : Number(existing?.carry_forward_allowed ?? 0),
    approval_required: payload.approvalRequired !== undefined || payload.approval_required !== undefined
      ? boolInt(payload.approvalRequired ?? payload.approval_required)
      : Number(existing?.approval_required ?? 1),
    hide: payload.hide !== undefined ? boolInt(payload.hide) : Number(existing?.hide ?? 0),
    notes: payload.notes ?? existing?.notes ?? "",
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function buildShiftTemplatePayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  const name = String(payload.name ?? existing?.name ?? "").trim();
  const startTime = String(payload.startTime ?? payload.start_time ?? existing?.start_time ?? "").trim();
  const endTime = String(payload.endTime ?? payload.end_time ?? existing?.end_time ?? "").trim();
  if (!name) throw badRequest("Shift name is required");
  if (!startTime || !endTime) throw badRequest("Shift start and end time are required");
  return {
    id: existing?.id || payload.id || makeId("shift"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    name,
    short_code: existing?.short_code || deriveCode(payload.shortCode ?? payload.short_code ?? name, "SH"),
    description: payload.description ?? existing?.description ?? "",
    start_time: startTime,
    end_time: endTime,
    break_minutes: parseNumber(payload.breakMinutes ?? payload.break_minutes ?? existing?.break_minutes, 0),
    color: payload.color ?? existing?.color ?? "#bbf7d0",
    shift_type: normalizeShiftType(payload.shiftType ?? payload.shift_type ?? existing?.shift_type ?? "regular"),
    hide: payload.hide !== undefined ? boolInt(payload.hide) : Number(existing?.hide ?? 0),
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function sanitizeAttendanceSlabs(value = []) {
  const rows = Array.isArray(value) ? value : [];
  return rows.slice(0, 50).map((item, index) => ({
    sNo: Number(item.sNo || item.s_no || index + 1),
    fromMinutes: parseNumber(item.fromMinutes ?? item.from_min ?? item.fromMin, 0),
    toMinutes: parseNumber(item.toMinutes ?? item.to_min ?? item.toMin, 0),
    statusId: String(item.statusId ?? item.status_id ?? "").trim(),
    statusName: String(item.statusName ?? item.status_name ?? item.status ?? "").trim()
  })).filter((item) => item.statusId || item.statusName || item.fromMinutes || item.toMinutes);
}

function sanitizeStringArray(value = []) {
  return (Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean);
}

function sanitizeTargetSlabs(value = []) {
  const rows = Array.isArray(value) ? value : [];
  return rows.slice(0, 50).map((item, index) => {
    const incentivePercent = parseNumber(item.incentivePercent ?? item.incePercent ?? item.ince_percent ?? item.incentive_percent, 0);
    const incentiveAmount = parseNumber(item.incentiveAmount ?? item.inceAmount ?? item.ince_amount ?? item.incentive_amount, 0);
    const employeeAmountPercent = parseNumber(item.employeeAmountPercent ?? item.employee_amount_percent ?? item.employeeAmountPct ?? incentivePercent, 0);
    const employeeAmount = parseNumber(item.employeeAmount ?? item.employee_amount ?? incentiveAmount, 0);
    return {
      sNo: Number(item.sNo || item.s_no || index + 1),
      fromAmount: parseNumber(item.fromAmount ?? item.from_amt ?? item.fromAmt, 0),
      toAmount: parseNumber(item.toAmount ?? item.to_amt ?? item.toAmt, 0),
      incentivePercent,
      incentiveAmount,
      employeeAmountPercent,
      employeeAmount
    };
  }).filter((item) =>
    item.fromAmount ||
    item.toAmount ||
    item.incentivePercent ||
    item.incentiveAmount ||
    item.employeeAmountPercent ||
    item.employeeAmount ||
    item.sNo === 1
  );
}

function sanitizeServiceSnapshot(value = []) {
  const rows = Array.isArray(value) ? value : [];
  return rows.slice(0, 1000).map((item) => ({
    id: String(item.id ?? item.serviceId ?? item.service_id ?? "").trim(),
    name: String(item.name ?? item.serviceName ?? item.service_name ?? "").trim(),
    category: String(item.category ?? item.categoryName ?? item.category_name ?? "").trim(),
    price: parseNumber(item.price, 0),
    durationMinutes: parseNumber(item.durationMinutes ?? item.duration_minutes, 0)
  })).filter((item) => item.id || item.name);
}

function sanitizePayrollToggleBlock(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...source,
    applicable: Boolean(boolInt(source.applicable ?? source.enabled ?? source.checked ?? false)),
    includeBasicSalary: Boolean(boolInt(source.includeBasicSalary ?? source.basicSalary ?? source.basic_salary ?? false)),
    includeIncentives: Boolean(boolInt(source.includeIncentives ?? source.incentives ?? false)),
    includeAbsentDays: Boolean(boolInt(source.includeAbsentDays ?? source.absentDays ?? source.absent_days ?? false))
  };
}

function sanitizeProvidentFund(value = {}) {
  const block = sanitizePayrollToggleBlock(value);
  return {
    ...block,
    pfNo: String(value.pfNo ?? value.pf_no ?? block.pfNo ?? "").trim(),
    employeeSharePercent: parseNumber(value.employeeSharePercent ?? value.employee_share_percent ?? block.employeeSharePercent, 0),
    epsContributionEmployerPercent: parseNumber(value.epsContributionEmployerPercent ?? value.eps_contribution_employer_percent ?? block.epsContributionEmployerPercent, 0),
    pfContributionEmployerPercent: parseNumber(value.pfContributionEmployerPercent ?? value.pf_contribution_employer_percent ?? block.pfContributionEmployerPercent, 0),
    dliEmployerPercent: parseNumber(value.dliEmployerPercent ?? value.dli_employer_percent ?? block.dliEmployerPercent, 0),
    pfAdminEmployerPercent: parseNumber(value.pfAdminEmployerPercent ?? value.pf_admin_employer_percent ?? block.pfAdminEmployerPercent, 0),
    dliAdminEmployerPercent: parseNumber(value.dliAdminEmployerPercent ?? value.dli_admin_employer_percent ?? block.dliAdminEmployerPercent, 0),
    maxSalaryPf: parseNumber(value.maxSalaryPf ?? value.max_salary_pf ?? block.maxSalaryPf, 0),
    maxSalaryEps: parseNumber(value.maxSalaryEps ?? value.max_salary_eps ?? block.maxSalaryEps, 0),
    maxSalaryDli: parseNumber(value.maxSalaryDli ?? value.max_salary_dli ?? block.maxSalaryDli, 0)
  };
}

function sanitizeProfessionalTax(value = {}) {
  const block = sanitizePayrollToggleBlock(value);
  return {
    ...block,
    ptNo: String(value.ptNo ?? value.pt_no ?? block.ptNo ?? "").trim(),
    mvatrcNo: String(value.mvatrcNo ?? value.mvatrc_no ?? value.mvatRcNo ?? block.mvatrcNo ?? "").trim(),
    slabs: Array.isArray(value.slabs) ? value.slabs.slice(0, 50).map((item, index) => ({
      sNo: Number(item.sNo || item.s_no || index + 1),
      fromAmount: parseNumber(item.fromAmount ?? item.from_amount, 0),
      toAmount: parseNumber(item.toAmount ?? item.to_amount, 0),
      taxAmount: parseNumber(item.taxAmount ?? item.tax_amount, 0)
    })) : []
  };
}

function sanitizeEsic(value = {}) {
  const block = sanitizePayrollToggleBlock(value);
  return {
    ...block,
    esicNo: String(value.esicNo ?? value.esic_no ?? block.esicNo ?? "").trim(),
    employeeSharePercent: parseNumber(value.employeeSharePercent ?? value.employee_share_percent ?? block.employeeSharePercent, 0),
    employerSharePercent: parseNumber(value.employerSharePercent ?? value.employer_share_percent ?? block.employerSharePercent, 0),
    maxSalaryEsic: parseNumber(value.maxSalaryEsic ?? value.max_salary_esic ?? block.maxSalaryEsic, 0)
  };
}

function sanitizeTds(value = {}) {
  const block = sanitizePayrollToggleBlock(value);
  return {
    ...block,
    employeeRules: Array.isArray(value.employeeRules ?? value.employee_rules) ? (value.employeeRules ?? value.employee_rules).slice(0, 100) : []
  };
}

function buildAttendanceCategoryMasterPayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  const name = String(payload.name ?? existing?.name ?? "").trim();
  if (!name) throw badRequest("Attendance category name is required");
  return {
    id: existing?.id || payload.id || makeId("attcat"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    name,
    working_duration_minutes: parseNumber(payload.workingDurationMinutes ?? payload.working_duration_minutes ?? existing?.working_duration_minutes, 0),
    in_time: payload.inTime ?? payload.in_time ?? existing?.in_time ?? "",
    out_time: payload.outTime ?? payload.out_time ?? existing?.out_time ?? "",
    overtime_applicable: payload.overtimeApplicable !== undefined || payload.overtime_applicable !== undefined
      ? boolInt(payload.overtimeApplicable ?? payload.overtime_applicable)
      : Number(existing?.overtime_applicable ?? 0),
    minimum_ot_duration_minutes: parseNumber(payload.minimumOtDurationMinutes ?? payload.minimum_ot_duration_minutes ?? existing?.minimum_ot_duration_minutes, 0),
    allowable_late_minutes: parseNumber(payload.allowableLateMinutes ?? payload.allowable_late_minutes ?? existing?.allowable_late_minutes, 0),
    late_mark_status_id: payload.lateMarkStatusId ?? payload.late_mark_status_id ?? existing?.late_mark_status_id ?? "",
    late_mark_after_count: parseNumber(payload.lateMarkAfterCount ?? payload.late_mark_after_count ?? existing?.late_mark_after_count, 0),
    late_mark_mode: normalizeAttendanceLateMarkMode(payload.lateMarkMode ?? payload.late_mark_mode ?? existing?.late_mark_mode ?? "every_x_late"),
    severe_late_status_id: payload.severeLateStatusId ?? payload.severe_late_status_id ?? existing?.severe_late_status_id ?? "",
    severe_late_after_minutes: parseNumber(payload.severeLateAfterMinutes ?? payload.severe_late_after_minutes ?? existing?.severe_late_after_minutes, 0),
    attendance_slab_json: json(sanitizeAttendanceSlabs(payload.attendanceSlabs ?? payload.attendance_slab ?? parseJsonArray(existing?.attendance_slab_json))),
    allowable_shift_ids_json: json(sanitizeStringArray(payload.allowableShiftIds ?? payload.allowable_shift_ids ?? parseJsonArray(existing?.allowable_shift_ids_json))),
    hide: payload.hide !== undefined ? boolInt(payload.hide) : Number(existing?.hide ?? 0),
    notes: payload.notes ?? existing?.notes ?? "",
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function buildTargetIncentiveMasterPayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  const assigneeType = normalizeTargetAssigneeType(payload.assigneeType ?? payload.assignee_type ?? existing?.assignee_type ?? "staff");
  const assigneeId = String(payload.assigneeId ?? payload.assignee_id ?? existing?.assignee_id ?? "").trim();
  if (assigneeType !== "standard" && !assigneeId) throw badRequest("Target incentive assignee is required");
  return {
    id: existing?.id || payload.id || makeId("tinc"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    target_type: normalizeTargetIncentiveType(payload.targetType ?? payload.target_type ?? existing?.target_type ?? "service"),
    assignee_type: assigneeType,
    assignee_id: assigneeId,
    assignee_name: String(payload.assigneeName ?? payload.assignee_name ?? existing?.assignee_name ?? (assigneeType === "standard" ? "Standard Definition" : "")).trim(),
    role_scope: normalizeTargetRoleScope(payload.roleScope ?? payload.role_scope ?? existing?.role_scope ?? "operator"),
    slabs_json: json(sanitizeTargetSlabs(payload.slabs ?? payload.targetSlabs ?? parseJsonArray(existing?.slabs_json))),
    notes: payload.notes ?? existing?.notes ?? "",
    hide: payload.hide !== undefined ? boolInt(payload.hide) : Number(existing?.hide ?? 0),
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function buildServiceAssignmentMasterPayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  const staffId = String(payload.staffId ?? payload.staff_id ?? existing?.staff_id ?? "").trim();
  if (!staffId) throw badRequest("staffId is required");
  const serviceIds = sanitizeStringArray(payload.serviceIds ?? payload.service_ids ?? parseJsonArray(existing?.service_ids_json));
  return {
    id: existing?.id || payload.id || makeId("svcassn"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    staff_id: staffId,
    staff_name: String(payload.staffName ?? payload.staff_name ?? existing?.staff_name ?? "").trim(),
    role_scope: normalizeTargetRoleScope(payload.roleScope ?? payload.role_scope ?? existing?.role_scope ?? "operator"),
    service_ids_json: json(serviceIds),
    service_snapshot_json: json(sanitizeServiceSnapshot(payload.services ?? payload.serviceSnapshot ?? payload.service_snapshot ?? parseJsonArray(existing?.service_snapshot_json))),
    category_filter_json: json(sanitizeStringArray(payload.categoryFilters ?? payload.category_filters ?? parseJsonArray(existing?.category_filter_json))),
    hide: payload.hide !== undefined ? boolInt(payload.hide) : Number(existing?.hide ?? 0),
    notes: payload.notes ?? existing?.notes ?? "",
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function buildFinePenaltyMasterPayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  const name = String(payload.name ?? existing?.name ?? "").trim();
  if (!name) throw badRequest("Fine/Penalty name is required");
  const payloadAmount = payload.amount !== undefined
    ? parseNumber(payload.amount, 0)
    : payload.amountPaise !== undefined
      ? parseNumber(payload.amountPaise, 0) / 100
      : payload.amount_paise !== undefined
        ? parseNumber(payload.amount_paise, 0) / 100
        : undefined;
  const amount = Math.max(0, parseNumber(payloadAmount ?? existing?.amount ?? (existing?.amount_paise ? Number(existing.amount_paise) / 100 : 0), 0));
  const amountPaise = Math.max(0, Math.round(parseNumber(
    payload.amountPaise ?? payload.amount_paise ?? (payloadAmount !== undefined ? amount * 100 : existing?.amount_paise ?? amount * 100),
    amount * 100
  )));
  return {
    id: existing?.id || payload.id || makeId("fine"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    name,
    amount,
    amount_paise: amountPaise,
    rule_type: normalizeFinePenaltyRuleType(payload.ruleType ?? payload.rule_type ?? existing?.rule_type ?? "manual"),
    rule_label: String(payload.ruleLabel ?? payload.rule_label ?? existing?.rule_label ?? "").trim().slice(0, 80),
    trigger_count: Math.max(1, parseNumber(payload.triggerCount ?? payload.trigger_count ?? existing?.trigger_count, 1)),
    apply_mode: normalizeFinePenaltyApplyMode(payload.applyMode ?? payload.apply_mode ?? existing?.apply_mode ?? "per_occurrence"),
    auto_deduct: payload.autoDeduct !== undefined ? boolInt(payload.autoDeduct) : payload.auto_deduct !== undefined ? boolInt(payload.auto_deduct) : Number(existing?.auto_deduct ?? 1),
    hide: payload.hide !== undefined ? boolInt(payload.hide) : Number(existing?.hide ?? 0),
    notes: payload.notes ?? existing?.notes ?? "",
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function buildAllowanceDeductionMasterPayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  const description = String(payload.description ?? payload.name ?? existing?.description ?? "").trim();
  if (!description) throw badRequest("Allowance/Deduction description is required");
  return {
    id: existing?.id || payload.id || makeId("alwded"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    description,
    entry_type: normalizeAllowanceDeductionType(payload.entryType ?? payload.entry_type ?? payload.type ?? existing?.entry_type ?? "allowance"),
    hide: payload.hide !== undefined ? boolInt(payload.hide) : Number(existing?.hide ?? 0),
    notes: payload.notes ?? existing?.notes ?? "",
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function buildPayrollSalaryStructurePayload(payload = {}, access, existing = null) {
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  if (branchId) assertBranch(access, branchId);
  return {
    id: existing?.id || payload.id || makeId("pstruct"),
    tenant_id: access.tenantId,
    branch_id: branchId,
    name: String(payload.name ?? existing?.name ?? "Default Payroll Salary Structure").trim(),
    provident_fund_json: json(sanitizeProvidentFund(payload.providentFund ?? payload.provident_fund ?? parseJsonObject(existing?.provident_fund_json))),
    professional_tax_json: json(sanitizeProfessionalTax(payload.professionalTax ?? payload.professional_tax ?? parseJsonObject(existing?.professional_tax_json))),
    esic_json: json(sanitizeEsic(payload.esic ?? parseJsonObject(existing?.esic_json))),
    tds_json: json(sanitizeTds(payload.tds ?? parseJsonObject(existing?.tds_json))),
    hide: payload.hide !== undefined ? boolInt(payload.hide) : Number(existing?.hide ?? 0),
    notes: payload.notes ?? existing?.notes ?? "",
    status: payload.status ?? existing?.status ?? "active",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

function hasEmployeeDetailsPayload(payload = {}) {
  return payload.employeeDetails !== undefined
    || payload.employee_details !== undefined
    || payload.shortName !== undefined
    || payload.short_name !== undefined
    || payload.contact !== undefined
    || payload.attendanceSalary !== undefined
    || payload.attendance_salary !== undefined;
}

function hasStaffLoginPayload(payload = {}) {
  const login = payload.staffLogin || payload.staff_login || {};
  return payload.loginId !== undefined
    || payload.login_id !== undefined
    || payload.loginPassword !== undefined
    || payload.password !== undefined
    || login.enabled
    || login.loginId !== undefined
    || login.login_id !== undefined
    || login.password !== undefined;
}

function staffIdentityForLogin(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    mobile: row.mobile,
    email: row.email,
    profilePhoto: row.profile_photo,
    roleId: row.role_id,
    designation: row.designation,
    status: row.status
  };
}

function buildStaffLoginPayload(payload = {}) {
  const login = payload.staffLogin || payload.staff_login || {};
  return {
    enabled: login.enabled ?? true,
    loginId: login.loginId ?? login.login_id ?? payload.loginId ?? payload.login_id ?? "",
    email: login.email ?? payload.loginEmail ?? payload.login_email ?? payload.email ?? "",
    password: login.password ?? payload.loginPassword ?? payload.login_password ?? payload.password ?? "",
    role: login.role ?? login.roleId ?? payload.loginRole ?? payload.login_role ?? payload.roleId ?? "staff",
    status: login.status ?? "active"
  };
}

function buildEmployeeDetailsPayload(staffId, branchId, payload = {}, access, existing = null) {
  const details = payload.employeeDetails || payload.employee_details || payload;
  const current = rowToEmployeeDetails(existing) || {};
  const pinValue = details.entryPin ?? details.entryPassword ?? details.entry_pin;
  const pinHash = hashStaffPin(pinValue);
  return {
    id: existing?.id || details.id || makeId("sdet"),
    tenant_id: access.tenantId,
    branch_id: branchId || existing?.branch_id || "",
    staff_id: staffId,
    short_name: details.shortName ?? details.short_name ?? current.shortName ?? "",
    last_working_date: details.lastWorkingDate ?? details.last_working_date ?? current.lastWorkingDate ?? "",
    anniversary_date: details.anniversaryDate ?? details.anniversary_date ?? current.anniversaryDate ?? "",
    hide_from_roster: details.hideFromRoster !== undefined || details.hide_from_roster !== undefined
      ? boolInt(details.hideFromRoster ?? details.hide_from_roster)
      : boolInt(current.hideFromRoster),
    allow_skip_otp: details.allowSkipOtp !== undefined || details.allow_skip_otp !== undefined
      ? boolInt(details.allowSkipOtp ?? details.allow_skip_otp)
      : boolInt(current.allowSkipOtp),
    entry_pin_salt: pinHash?.salt ?? existing?.entry_pin_salt ?? "",
    entry_pin_hash: pinHash?.hash ?? existing?.entry_pin_hash ?? "",
    entry_pin_set: pinHash ? 1 : Number(existing?.entry_pin_set || 0),
    multi_branch_access_json: json(details.multiBranchAccess ?? details.multi_branch_access ?? current.multiBranchAccess ?? []),
    contact_json: json(details.contact ?? current.contact ?? {}),
    emergency_contact_json: json(details.emergencyContact ?? details.emergency_contact ?? current.emergencyContact ?? {}),
    native_contact_json: json(details.nativeContact ?? details.native_contact ?? current.nativeContact ?? {}),
    incentive_json: json(details.incentive ?? current.incentive ?? {}),
    attendance_salary_json: json(details.attendanceSalary ?? details.attendance_salary ?? current.attendanceSalary ?? {}),
    remarks: details.remarks ?? current.remarks ?? "",
    imei_no: details.imeiNo ?? details.imei_no ?? current.imeiNo ?? "",
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_at: existing?.created_at || now(),
    updated_at: now()
  };
}

export class StaffOsService {
  uploadStaffPhoto(payload = {}, access = {}, options = {}) {
    access = normalizeAccess(access);
    requireManager(access);
    const branchId = pickBranch(payload, access);
    assertBranch(access, branchId);

    const mimeType = String(payload.mimeType || "").toLowerCase();
    const extension = mediaExtension(payload);
    if (!mimeType.startsWith("image/") || !extension) {
      throw badRequest("Only JPG, PNG and common photo files are allowed");
    }

    const rawData = String(payload.dataUrl || payload.content || "");
    const base64 = (rawData.includes(",") ? rawData.split(",").pop() : rawData).replace(/\s+/g, "");
    if (!base64 || !/^[a-zA-Z0-9+/=]+$/.test(base64)) {
      throw badRequest("Staff photo is required");
    }

    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length || buffer.length > MAX_STAFF_MEDIA_BYTES) {
      throw badRequest("Staff photo size must be 5 MB or less");
    }
    if (!imageSignatureMatches(buffer, mimeType)) {
      throw badRequest("Uploaded file is not a valid photo");
    }

    const tenantSegment = safePathSegment(access.tenantId, "tenant");
    const branchSegment = safePathSegment(branchId, "branch");
    const uploadDir = join(dataDir, "uploads", "staff-media", tenantSegment, branchSegment);
    const fileName = `staff_${Date.now()}_${makeId("img")}${extension}`;
    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(join(uploadDir, fileName), buffer, { flag: "wx" });

    const path = `/uploads/staff-media/${tenantSegment}/${branchSegment}/${fileName}`;
    const publicBaseUrl = String(options.publicBaseUrl || "").replace(/\/+$/, "");
    const url = publicBaseUrl ? `${publicBaseUrl}${path}` : path;
    this.writeAudit("staff.photo_uploaded", "staff_master", payload.staffId || "new", access, {
      branchId,
      fileName: String(payload.fileName || ""),
      mimeType,
      sizeBytes: buffer.length,
      url
    });
    return { url, path, mimeType, sizeBytes: buffer.length, branchId };
  }

  listStaff(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 50), 200)
    };
    const filters = [branchScopedWhere(access, params, "sm")];
    if (params.status) filters.push("sm.status = @status");
    if (params.q) filters.push("(lower(sm.full_name) LIKE @q OR lower(sm.mobile) LIKE @q OR lower(sm.email) LIKE @q OR lower(sc.name) LIKE @q)");
    return db.prepare(`SELECT sm.*, sc.id AS staff_category_id, sc.name AS staff_category_name, sc.scope AS staff_category_scope,
        tu.id AS login_user_id, tu.loginId AS login_id, tu.email AS login_email,
        tu.status AS login_status, CASE WHEN COALESCE(tu.passwordHash, '') != '' THEN 1 ELSE 0 END AS login_password_set
      FROM staff_master sm
      LEFT JOIN staff_category_assignments sca ON sca.tenant_id = sm.tenant_id AND sca.staff_id = sm.id AND sca.status = 'active'
      LEFT JOIN staff_categories sc ON sc.tenant_id = sm.tenant_id AND sc.id = sca.category_id
      LEFT JOIN tenant_users tu ON tu.tenantId = sm.tenant_id AND tu.staffId = sm.id
      WHERE ${filters.join(" AND ")}
      ORDER BY sm.full_name ASC LIMIT @limit`).all(params).map((row) => ({
        ...rowToStaff(row),
        employeeDetails: this.getStaffEmployeeDetails(row.id, access, true)
      }));
  }

  createStaff(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const data = buildStaffPayload(payload, access);
    const staffCategoryId = payload.staffCategoryId || payload.staff_category_id || "";
    const trx = db.transaction(() => {
      db.prepare(`INSERT INTO staff_master (
        id, tenant_id, branch_id, employee_code, first_name, last_name, full_name, mobile, email, gender, dob,
        profile_photo, joining_date, employment_type, status, role_id, department, designation,
        emergency_contact_name, emergency_contact_mobile, address, city, state, pincode, notes,
        version, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @employee_code, @first_name, @last_name, @full_name, @mobile, @email, @gender, @dob,
        @profile_photo, @joining_date, @employment_type, @status, @role_id, @department, @designation,
        @emergency_contact_name, @emergency_contact_mobile, @address, @city, @state, @pincode, @notes,
        @version, @created_at, @updated_at
      )`).run(data);
      db.prepare(`INSERT OR IGNORE INTO staff_branch_assignments (id, tenant_id, staff_id, branch_id, assignment_type, starts_at, status)
        VALUES (?, ?, ?, ?, 'primary', ?, 'active')`).run(makeId("sba"), access.tenantId, data.id, data.branch_id, data.joining_date);
      if (staffCategoryId) this.assignStaffCategory(data.id, staffCategoryId, data.branch_id, access);
      if (hasEmployeeDetailsPayload(payload)) this.upsertStaffEmployeeDetails(data.id, data.branch_id, payload, access);
      const staffIdentity = staffIdentityForLogin(data);
      staffLoginService.syncCoreStaffFromStaffMaster(staffIdentity, access);
      if (hasStaffLoginPayload(payload)) staffLoginService.upsertStaffLogin(staffIdentity, buildStaffLoginPayload(payload), access);
      this.writeAudit("staff.created", "staff_master", data.id, access, { after: data, branchId: data.branch_id });
      return this.getStaff(data.id, access);
    });
    const staff = trx();
    this.emit("staff:created", access, staff.branchId, staff.id);
    return staff;
  }

  getStaff(id, access) {
    access = normalizeAccess(access);
    const row = db.prepare(`SELECT sm.*, sc.id AS staff_category_id, sc.name AS staff_category_name, sc.scope AS staff_category_scope,
        tu.id AS login_user_id, tu.loginId AS login_id, tu.email AS login_email,
        tu.status AS login_status, CASE WHEN COALESCE(tu.passwordHash, '') != '' THEN 1 ELSE 0 END AS login_password_set
      FROM staff_master sm
      LEFT JOIN staff_category_assignments sca ON sca.tenant_id = sm.tenant_id AND sca.staff_id = sm.id AND sca.status = 'active'
      LEFT JOIN staff_categories sc ON sc.tenant_id = sm.tenant_id AND sc.id = sca.category_id
      LEFT JOIN tenant_users tu ON tu.tenantId = sm.tenant_id AND tu.staffId = sm.id
      WHERE sm.id = ? AND sm.tenant_id = ?`).get(id, access.tenantId);
    if (!row) throw notFound("Staff record not found");
    if (["staff", "frontDesk"].includes(access.role)) tenantService.assertBranchAccess(access, row.branch_id);
    return { ...rowToStaff(row), employeeDetails: this.getStaffEmployeeDetails(id, access, true) };
  }

  updateStaff(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Staff record not found");
    assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version)) throw conflict("Staff record has been updated by another request");
    const nextBranchId = pickBranch(payload, access) || existing.branch_id;
    assertBranch(access, nextBranchId);
    const next = {
      id,
      tenant_id: access.tenantId,
      branch_id: nextBranchId,
      employee_code: payload.employeeCode ?? payload.employee_code ?? existing.employee_code,
      first_name: payload.firstName ?? payload.first_name ?? existing.first_name,
      last_name: payload.lastName ?? payload.last_name ?? existing.last_name,
      full_name: payload.fullName ?? payload.full_name ?? existing.full_name,
      mobile: payload.mobile ?? payload.phone ?? existing.mobile,
      email: payload.email ?? existing.email,
      gender: payload.gender ?? existing.gender,
      dob: payload.dob ?? existing.dob,
      profile_photo: payload.profilePhoto ?? payload.profile_photo ?? existing.profile_photo,
      joining_date: payload.joiningDate ?? payload.joining_date ?? existing.joining_date,
      employment_type: payload.employmentType ?? payload.employment_type ?? existing.employment_type,
      status: payload.status ?? existing.status,
      role_id: payload.roleId ?? payload.role_id ?? existing.role_id,
      department: payload.department ?? existing.department,
      designation: payload.designation ?? existing.designation,
      emergency_contact_name: payload.emergencyContactName ?? payload.emergency_contact_name ?? existing.emergency_contact_name,
      emergency_contact_mobile: payload.emergencyContactMobile ?? payload.emergency_contact_mobile ?? existing.emergency_contact_mobile,
      address: payload.address ?? existing.address,
      city: payload.city ?? existing.city,
      state: payload.state ?? existing.state,
      pincode: payload.pincode ?? existing.pincode,
      notes: payload.notes ?? existing.notes,
      version: Number(existing.version || 1) + 1,
      updated_at: now()
    };
    const hasCategoryPatch = payload.staffCategoryId !== undefined || payload.staff_category_id !== undefined;
    const staffCategoryId = payload.staffCategoryId ?? payload.staff_category_id ?? "";
    const trx = db.transaction(() => {
      db.prepare(`UPDATE staff_master SET
        branch_id = @branch_id, employee_code = @employee_code, first_name = @first_name, last_name = @last_name,
        full_name = @full_name, mobile = @mobile, email = @email, gender = @gender, dob = @dob,
        profile_photo = @profile_photo, joining_date = @joining_date, employment_type = @employment_type,
        status = @status, role_id = @role_id, department = @department, designation = @designation,
        emergency_contact_name = @emergency_contact_name, emergency_contact_mobile = @emergency_contact_mobile,
        address = @address, city = @city, state = @state, pincode = @pincode, notes = @notes,
        version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      if (existing.branch_id !== nextBranchId) {
        db.prepare(`INSERT INTO staff_branch_assignments (id, tenant_id, staff_id, branch_id, assignment_type, starts_at, status)
          VALUES (?, ?, ?, ?, 'transfer', ?, 'active')`).run(makeId("sba"), access.tenantId, id, nextBranchId, now());
      }
      if (hasCategoryPatch) this.assignStaffCategory(id, staffCategoryId, nextBranchId, access);
      if (hasEmployeeDetailsPayload(payload)) this.upsertStaffEmployeeDetails(id, nextBranchId, payload, access);
      const staffIdentity = staffIdentityForLogin(next);
      staffLoginService.syncCoreStaffFromStaffMaster(staffIdentity, access);
      if (hasStaffLoginPayload(payload)) staffLoginService.upsertStaffLogin(staffIdentity, buildStaffLoginPayload(payload), access);
      this.writeAudit("staff.updated", "staff_master", id, access, { before: existing, after: next, branchId: nextBranchId });
      return this.getStaff(id, access);
    });
    const staff = trx();
    this.emit("staff:updated", access, staff.branchId, staff.id);
    return staff;
  }

  updateStaffStatus(id, payload = {}, access) {
    return this.updateStaff(id, { status: payload.status, version: payload.version }, access);
  }

  getStaffEmployeeDetails(staffId, access, optional = false) {
    access = normalizeAccess(access);
    const row = db.prepare("SELECT * FROM staff_employee_details WHERE staff_id = ? AND tenant_id = ?")
      .get(staffId, access.tenantId);
    if (!row) {
      if (optional) return null;
      throw notFound("Staff employee details not found");
    }
    if (row.branch_id) assertBranch(access, row.branch_id);
    return rowToEmployeeDetails(row);
  }

  upsertStaffEmployeeDetails(staffId, branchId, payload = {}, access) {
    const existing = db.prepare("SELECT * FROM staff_employee_details WHERE staff_id = ? AND tenant_id = ?")
      .get(staffId, access.tenantId);
    const row = buildEmployeeDetailsPayload(staffId, branchId, payload, access, existing);
    if (existing) {
      db.prepare(`UPDATE staff_employee_details SET
        branch_id = @branch_id, short_name = @short_name, last_working_date = @last_working_date,
        anniversary_date = @anniversary_date, hide_from_roster = @hide_from_roster,
        allow_skip_otp = @allow_skip_otp, entry_pin_salt = @entry_pin_salt,
        entry_pin_hash = @entry_pin_hash, entry_pin_set = @entry_pin_set,
        multi_branch_access_json = @multi_branch_access_json, contact_json = @contact_json,
        emergency_contact_json = @emergency_contact_json, native_contact_json = @native_contact_json,
        incentive_json = @incentive_json, attendance_salary_json = @attendance_salary_json,
        remarks = @remarks, imei_no = @imei_no, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(row);
    } else {
      db.prepare(`INSERT INTO staff_employee_details (
        id, tenant_id, branch_id, staff_id, short_name, last_working_date, anniversary_date,
        hide_from_roster, allow_skip_otp, entry_pin_salt, entry_pin_hash, entry_pin_set,
        multi_branch_access_json, contact_json, emergency_contact_json, native_contact_json,
        incentive_json, attendance_salary_json, remarks, imei_no, version, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @staff_id, @short_name, @last_working_date, @anniversary_date,
        @hide_from_roster, @allow_skip_otp, @entry_pin_salt, @entry_pin_hash, @entry_pin_set,
        @multi_branch_access_json, @contact_json, @emergency_contact_json, @native_contact_json,
        @incentive_json, @attendance_salary_json, @remarks, @imei_no, @version, @created_at, @updated_at
      )`).run(row);
    }
    this.writeAudit(existing ? "staff.details_updated" : "staff.details_created", "staff_employee_details", row.id, access, {
      before: sanitizeEmployeeDetailsForAudit(existing),
      after: sanitizeEmployeeDetailsForAudit(row),
      branchId: row.branch_id
    });
    return rowToEmployeeDetails(row);
  }

  listStaffCategories(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      scope: query.scope ? normalizeStaffCategoryScope(query.scope) : "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 200), 500)
    };
    const filters = ["tenant_id = @tenant_id"];
    if (params.branch_id) filters.push("(branch_id = @branch_id OR branch_id = '')");
    if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
      filters.push("(branch_id = @access_branch_id OR branch_id = '')");
      params.access_branch_id = access.branchId;
    }
    if (params.status) filters.push("status = @status");
    if (params.scope) filters.push("scope = @scope");
    if (params.q) filters.push("lower(name) LIKE @q");
    return db.prepare(`SELECT * FROM staff_categories WHERE ${filters.join(" AND ")} ORDER BY status ASC, scope ASC, name ASC LIMIT @limit`)
      .all(params).map(rowToStaffCategory);
  }

  getStaffCategory(id, access) {
    access = normalizeAccess(access);
    const row = db.prepare("SELECT * FROM staff_categories WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Staff category not found");
    if (row.branch_id) assertBranch(access, row.branch_id);
    return rowToStaffCategory(row);
  }

  createStaffCategory(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const row = buildStaffCategoryPayload(payload, access);
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_categories (
        id, tenant_id, branch_id, name, scope, department, default_designation, default_employment_type,
        fixed_incentive_amount, fixed_incentive_percent, service_eligibility_json, skill_license_json,
        notes, status, version, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @name, @scope, @department, @default_designation, @default_employment_type,
        @fixed_incentive_amount, @fixed_incentive_percent, @service_eligibility_json, @skill_license_json,
        @notes, @status, @version, @created_at, @updated_at
      )`).run(row);
      this.writeAudit("staff.category_created", "staff_categories", row.id, access, { after: row, branchId: row.branch_id });
    })();
    this.emit("staff:category_created", access, row.branch_id, row.id);
    return this.getStaffCategory(row.id, access);
  }

  updateStaffCategory(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_categories WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Staff category not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version)) throw conflict("Staff category has been updated by another request");
    const next = buildStaffCategoryPayload(payload, access, existing);
    db.transaction(() => {
      db.prepare(`UPDATE staff_categories SET
        branch_id = @branch_id, name = @name, scope = @scope, department = @department,
        default_designation = @default_designation, default_employment_type = @default_employment_type,
        fixed_incentive_amount = @fixed_incentive_amount, fixed_incentive_percent = @fixed_incentive_percent,
        service_eligibility_json = @service_eligibility_json, skill_license_json = @skill_license_json,
        notes = @notes, status = @status, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.category_updated", "staff_categories", id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    this.emit("staff:category_updated", access, next.branch_id, id);
    return this.getStaffCategory(id, access);
  }

  updateStaffCategoryStatus(id, payload = {}, access) {
    return this.updateStaffCategory(id, { status: payload.status, version: payload.version }, access);
  }

  listAttendanceStatusMasters(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 200), 500)
    };
    const filters = ["tenant_id = @tenant_id"];
    if (params.branch_id) filters.push("(branch_id = @branch_id OR branch_id = '')");
    if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
      filters.push("(branch_id = @access_branch_id OR branch_id = '')");
      params.access_branch_id = access.branchId;
    }
    if (params.status) filters.push("status = @status");
    if (query.visibleOnly === "true" || query.visibleOnly === true) filters.push("hide = 0");
    if (params.q) filters.push("(lower(name) LIKE @q OR lower(code) LIKE @q)");
    return db.prepare(`SELECT * FROM staff_attendance_status_master WHERE ${filters.join(" AND ")}
      ORDER BY hide ASC, sort_order ASC, code ASC LIMIT @limit`).all(params).map(rowToAttendanceStatusMaster);
  }

  getAttendanceStatusMaster(id, access) {
    access = normalizeAccess(access);
    const row = db.prepare("SELECT * FROM staff_attendance_status_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Attendance master not found");
    if (row.branch_id) assertBranch(access, row.branch_id);
    return rowToAttendanceStatusMaster(row);
  }

  createAttendanceStatusMaster(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const row = buildAttendanceStatusMasterPayload(payload, access);
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_attendance_status_master (
        id, tenant_id, branch_id, code, name, day_count, paid, available_for_appointment, hide,
        color, sort_order, notes, status, version, created_by, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @code, @name, @day_count, @paid, @available_for_appointment, @hide,
        @color, @sort_order, @notes, @status, @version, @created_by, @created_at, @updated_at
      )`).run(row);
      this.writeAudit("staff.attendance_master_created", "staff_attendance_status_master", row.id, access, { after: row, branchId: row.branch_id });
    })();
    this.emit("staff:attendance_master_created", access, row.branch_id, row.id);
    return this.getAttendanceStatusMaster(row.id, access);
  }

  updateAttendanceStatusMaster(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_attendance_status_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Attendance master not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version)) throw conflict("Attendance master has been updated by another request");
    const next = buildAttendanceStatusMasterPayload(payload, access, existing);
    db.transaction(() => {
      db.prepare(`UPDATE staff_attendance_status_master SET
        branch_id = @branch_id, name = @name, day_count = @day_count, paid = @paid,
        available_for_appointment = @available_for_appointment, hide = @hide, color = @color,
        sort_order = @sort_order, notes = @notes, status = @status, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.attendance_master_updated", "staff_attendance_status_master", id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    this.emit("staff:attendance_master_updated", access, next.branch_id, id);
    return this.getAttendanceStatusMaster(id, access);
  }

  updateAttendanceStatusMasterStatus(id, payload = {}, access) {
    return this.updateAttendanceStatusMaster(id, {
      status: payload.status,
      hide: payload.hide,
      version: payload.version
    }, access);
  }

  listLeaveTypeMasters(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 200), 500)
    };
    const filters = ["tenant_id = @tenant_id"];
    if (params.branch_id) filters.push("(branch_id = @branch_id OR branch_id = '')");
    if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
      filters.push("(branch_id = @access_branch_id OR branch_id = '')");
      params.access_branch_id = access.branchId;
    }
    if (params.status) filters.push("status = @status");
    if (query.visibleOnly === "true" || query.visibleOnly === true) filters.push("hide = 0");
    if (params.q) filters.push("(lower(name) LIKE @q OR lower(code) LIKE @q)");
    return db.prepare(`SELECT * FROM staff_leave_type_master WHERE ${filters.join(" AND ")}
      ORDER BY hide ASC, code ASC LIMIT @limit`).all(params).map(rowToLeaveTypeMaster);
  }

  getLeaveTypeMaster(id, access) {
    access = normalizeAccess(access);
    const row = db.prepare("SELECT * FROM staff_leave_type_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Leave master not found");
    if (row.branch_id) assertBranch(access, row.branch_id);
    return rowToLeaveTypeMaster(row);
  }

  createLeaveTypeMaster(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const row = buildLeaveTypeMasterPayload(payload, access);
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_leave_type_master (
        id, tenant_id, branch_id, code, name, day_count, paid, available_for_appointment,
        leave_quota, quota_period, shift_template_id, shift_name, carry_forward_allowed,
        approval_required, hide, notes, status, version, created_by, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @code, @name, @day_count, @paid, @available_for_appointment,
        @leave_quota, @quota_period, @shift_template_id, @shift_name, @carry_forward_allowed,
        @approval_required, @hide, @notes, @status, @version, @created_by, @created_at, @updated_at
      )`).run(row);
      this.writeAudit("staff.leave_master_created", "staff_leave_type_master", row.id, access, { after: row, branchId: row.branch_id });
    })();
    this.emit("staff:leave_master_created", access, row.branch_id, row.id);
    return this.getLeaveTypeMaster(row.id, access);
  }

  updateLeaveTypeMaster(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_leave_type_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Leave master not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version)) throw conflict("Leave master has been updated by another request");
    const next = buildLeaveTypeMasterPayload(payload, access, existing);
    db.transaction(() => {
      db.prepare(`UPDATE staff_leave_type_master SET
        branch_id = @branch_id, name = @name, day_count = @day_count, paid = @paid,
        available_for_appointment = @available_for_appointment, leave_quota = @leave_quota,
        quota_period = @quota_period, shift_template_id = @shift_template_id, shift_name = @shift_name,
        carry_forward_allowed = @carry_forward_allowed, approval_required = @approval_required,
        hide = @hide, notes = @notes, status = @status, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.leave_master_updated", "staff_leave_type_master", id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    this.emit("staff:leave_master_updated", access, next.branch_id, id);
    return this.getLeaveTypeMaster(id, access);
  }

  updateLeaveTypeMasterStatus(id, payload = {}, access) {
    return this.updateLeaveTypeMaster(id, {
      status: payload.status,
      hide: payload.hide,
      version: payload.version
    }, access);
  }

  listShiftTemplates(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      shift_type: query.shiftType || query.shift_type || "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 200), 500)
    };
    const filters = ["tenant_id = @tenant_id"];
    if (params.branch_id) filters.push("(branch_id = @branch_id OR branch_id = '')");
    if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
      filters.push("(branch_id = @access_branch_id OR branch_id = '')");
      params.access_branch_id = access.branchId;
    }
    if (params.status) filters.push("status = @status");
    if (params.shift_type) filters.push("shift_type = @shift_type");
    if (query.visibleOnly === "true" || query.visibleOnly === true) filters.push("hide = 0");
    if (params.q) filters.push("(lower(name) LIKE @q OR lower(short_code) LIKE @q OR lower(description) LIKE @q)");
    return db.prepare(`SELECT * FROM staff_shift_templates WHERE ${filters.join(" AND ")}
      ORDER BY hide ASC, shift_type ASC, start_time ASC, name ASC LIMIT @limit`).all(params).map(rowToShiftTemplate);
  }

  getShiftTemplate(id, access) {
    access = normalizeAccess(access);
    const row = db.prepare("SELECT * FROM staff_shift_templates WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Shift master not found");
    if (row.branch_id) assertBranch(access, row.branch_id);
    return rowToShiftTemplate(row);
  }

  createShiftTemplate(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const row = buildShiftTemplatePayload(payload, access);
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_shift_templates (
        id, tenant_id, branch_id, name, short_code, description, start_time, end_time,
        break_minutes, color, shift_type, hide, status, version, created_by, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @name, @short_code, @description, @start_time, @end_time,
        @break_minutes, @color, @shift_type, @hide, @status, @version, @created_by, @created_at, @updated_at
      )`).run(row);
      this.writeAudit("staff.shift_master_created", "staff_shift_templates", row.id, access, { after: row, branchId: row.branch_id });
    })();
    this.emit("staff:shift_master_created", access, row.branch_id, row.id);
    return this.getShiftTemplate(row.id, access);
  }

  updateShiftTemplate(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_shift_templates WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Shift master not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version || 1)) throw conflict("Shift master has been updated by another request");
    const next = buildShiftTemplatePayload(payload, access, existing);
    db.transaction(() => {
      db.prepare(`UPDATE staff_shift_templates SET
        branch_id = @branch_id, name = @name, description = @description, start_time = @start_time,
        end_time = @end_time, break_minutes = @break_minutes, color = @color, shift_type = @shift_type,
        hide = @hide, status = @status, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.shift_master_updated", "staff_shift_templates", id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    this.emit("staff:shift_master_updated", access, next.branch_id, id);
    return this.getShiftTemplate(id, access);
  }

  updateShiftTemplateStatus(id, payload = {}, access) {
    return this.updateShiftTemplate(id, {
      status: payload.status,
      hide: payload.hide,
      version: payload.version
    }, access);
  }

  listAttendanceCategoryMasters(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 200), 500)
    };
    const filters = ["tenant_id = @tenant_id"];
    if (params.branch_id) filters.push("(branch_id = @branch_id OR branch_id = '')");
    if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
      filters.push("(branch_id = @access_branch_id OR branch_id = '')");
      params.access_branch_id = access.branchId;
    }
    if (params.status) filters.push("status = @status");
    if (query.visibleOnly === "true" || query.visibleOnly === true) filters.push("hide = 0");
    if (params.q) filters.push("lower(name) LIKE @q");
    return db.prepare(`SELECT * FROM staff_attendance_category_master WHERE ${filters.join(" AND ")}
      ORDER BY hide ASC, name ASC LIMIT @limit`).all(params).map(rowToAttendanceCategoryMaster);
  }

  getAttendanceCategoryMaster(id, access) {
    access = normalizeAccess(access);
    const row = db.prepare("SELECT * FROM staff_attendance_category_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Attendance category not found");
    if (row.branch_id) assertBranch(access, row.branch_id);
    return rowToAttendanceCategoryMaster(row);
  }

  createAttendanceCategoryMaster(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const row = buildAttendanceCategoryMasterPayload(payload, access);
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_attendance_category_master (
        id, tenant_id, branch_id, name, working_duration_minutes, in_time, out_time,
        overtime_applicable, minimum_ot_duration_minutes, allowable_late_minutes,
        late_mark_status_id, late_mark_after_count, late_mark_mode, severe_late_status_id,
        severe_late_after_minutes, attendance_slab_json, allowable_shift_ids_json,
        hide, notes, status, version, created_by, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @name, @working_duration_minutes, @in_time, @out_time,
        @overtime_applicable, @minimum_ot_duration_minutes, @allowable_late_minutes,
        @late_mark_status_id, @late_mark_after_count, @late_mark_mode, @severe_late_status_id,
        @severe_late_after_minutes, @attendance_slab_json, @allowable_shift_ids_json,
        @hide, @notes, @status, @version, @created_by, @created_at, @updated_at
      )`).run(row);
      this.writeAudit("staff.attendance_category_created", "staff_attendance_category_master", row.id, access, { after: row, branchId: row.branch_id });
    })();
    this.emit("staff:attendance_category_created", access, row.branch_id, row.id);
    return this.getAttendanceCategoryMaster(row.id, access);
  }

  updateAttendanceCategoryMaster(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_attendance_category_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Attendance category not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version || 1)) throw conflict("Attendance category has been updated by another request");
    const next = buildAttendanceCategoryMasterPayload(payload, access, existing);
    db.transaction(() => {
      db.prepare(`UPDATE staff_attendance_category_master SET
        branch_id = @branch_id, name = @name, working_duration_minutes = @working_duration_minutes,
        in_time = @in_time, out_time = @out_time, overtime_applicable = @overtime_applicable,
        minimum_ot_duration_minutes = @minimum_ot_duration_minutes, allowable_late_minutes = @allowable_late_minutes,
        late_mark_status_id = @late_mark_status_id, late_mark_after_count = @late_mark_after_count,
        late_mark_mode = @late_mark_mode, severe_late_status_id = @severe_late_status_id,
        severe_late_after_minutes = @severe_late_after_minutes, attendance_slab_json = @attendance_slab_json,
        allowable_shift_ids_json = @allowable_shift_ids_json, hide = @hide, notes = @notes,
        status = @status, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.attendance_category_updated", "staff_attendance_category_master", id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    this.emit("staff:attendance_category_updated", access, next.branch_id, id);
    return this.getAttendanceCategoryMaster(id, access);
  }

  updateAttendanceCategoryMasterStatus(id, payload = {}, access) {
    return this.updateAttendanceCategoryMaster(id, {
      status: payload.status,
      hide: payload.hide,
      version: payload.version
    }, access);
  }

  listTargetIncentiveMasters(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      target_type: query.targetType || query.target_type || "",
      assignee_type: query.assigneeType || query.assignee_type || "",
      assignee_id: query.assigneeId || query.assignee_id || "",
      role_scope: query.roleScope || query.role_scope || "",
      status: query.status || "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 500), 1000)
    };
    const filters = ["tenant_id = @tenant_id"];
    if (params.branch_id) filters.push("(branch_id = @branch_id OR branch_id = '')");
    if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
      filters.push("(branch_id = @access_branch_id OR branch_id = '')");
      params.access_branch_id = access.branchId;
    }
    if (params.target_type) {
      params.target_type = normalizeTargetIncentiveType(params.target_type);
      filters.push("target_type = @target_type");
    }
    if (params.assignee_type) {
      params.assignee_type = normalizeTargetAssigneeType(params.assignee_type);
      filters.push("assignee_type = @assignee_type");
    }
    if (params.assignee_id) filters.push("assignee_id = @assignee_id");
    if (params.role_scope) {
      params.role_scope = normalizeTargetRoleScope(params.role_scope);
      filters.push("role_scope = @role_scope");
    }
    if (params.status) filters.push("status = @status");
    if (query.visibleOnly === "true" || query.visibleOnly === true) filters.push("hide = 0");
    if (params.q) filters.push("(lower(assignee_name) LIKE @q OR lower(notes) LIKE @q)");
    return db.prepare(`SELECT * FROM staff_target_incentive_master WHERE ${filters.join(" AND ")}
      ORDER BY target_type ASC, role_scope ASC, assignee_name ASC LIMIT @limit`).all(params).map(rowToTargetIncentiveMaster);
  }

  getTargetIncentiveMaster(id, access) {
    access = normalizeAccess(access);
    const row = db.prepare("SELECT * FROM staff_target_incentive_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Target incentive not found");
    if (row.branch_id) assertBranch(access, row.branch_id);
    return rowToTargetIncentiveMaster(row);
  }

  createTargetIncentiveMaster(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const row = buildTargetIncentiveMasterPayload(payload, access);
    const existing = db.prepare(`SELECT id FROM staff_target_incentive_master
      WHERE tenant_id = ? AND branch_id = ? AND target_type = ? AND assignee_type = ? AND assignee_id = ? AND role_scope = ?`)
      .get(row.tenant_id, row.branch_id, row.target_type, row.assignee_type, row.assignee_id, row.role_scope);
    if (existing) throw conflict("Target incentive already exists for this assignee");
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_target_incentive_master (
        id, tenant_id, branch_id, target_type, assignee_type, assignee_id, assignee_name,
        role_scope, slabs_json, notes, hide, status, version, created_by, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @target_type, @assignee_type, @assignee_id, @assignee_name,
        @role_scope, @slabs_json, @notes, @hide, @status, @version, @created_by, @created_at, @updated_at
      )`).run(row);
      this.writeAudit("staff.target_incentive_created", "staff_target_incentive_master", row.id, access, { after: row, branchId: row.branch_id });
    })();
    this.emit("staff:target_incentive_created", access, row.branch_id, row.id);
    return this.getTargetIncentiveMaster(row.id, access);
  }

  updateTargetIncentiveMaster(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_target_incentive_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Target incentive not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version || 1)) throw conflict("Target incentive has been updated by another request");
    const next = buildTargetIncentiveMasterPayload(payload, access, existing);
    db.transaction(() => {
      db.prepare(`UPDATE staff_target_incentive_master SET
        branch_id = @branch_id, target_type = @target_type, assignee_type = @assignee_type,
        assignee_id = @assignee_id, assignee_name = @assignee_name, role_scope = @role_scope,
        slabs_json = @slabs_json, notes = @notes, hide = @hide, status = @status,
        version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.target_incentive_updated", "staff_target_incentive_master", id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    this.emit("staff:target_incentive_updated", access, next.branch_id, id);
    return this.getTargetIncentiveMaster(id, access);
  }

  updateTargetIncentiveMasterStatus(id, payload = {}, access) {
    return this.updateTargetIncentiveMaster(id, {
      status: payload.status,
      hide: payload.hide,
      version: payload.version
    }, access);
  }

  copyTargetIncentiveMaster(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const source = db.prepare("SELECT * FROM staff_target_incentive_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!source) throw notFound("Target incentive not found");
    if (source.branch_id) assertBranch(access, source.branch_id);
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    if (!targets.length) throw badRequest("targets are required for Save & Copy To");
    const saved = [];
    db.transaction(() => {
      for (const target of targets.slice(0, 100)) {
        const candidate = {
          branchId: target.branchId ?? payload.branchId ?? source.branch_id,
          targetType: source.target_type,
          assigneeType: target.assigneeType ?? source.assignee_type,
          assigneeId: target.assigneeId ?? target.id,
          assigneeName: target.assigneeName ?? target.name ?? "",
          roleScope: target.roleScope ?? source.role_scope,
          slabs: parseJsonArray(source.slabs_json),
          notes: payload.notes ?? source.notes,
          hide: false,
          status: "active"
        };
        const existing = db.prepare(`SELECT * FROM staff_target_incentive_master
          WHERE tenant_id = ? AND branch_id = ? AND target_type = ? AND assignee_type = ? AND assignee_id = ? AND role_scope = ?`)
          .get(access.tenantId, candidate.branchId, source.target_type, candidate.assigneeType, candidate.assigneeId, candidate.roleScope);
        const row = buildTargetIncentiveMasterPayload(candidate, access, existing || null);
        if (existing) {
          db.prepare(`UPDATE staff_target_incentive_master SET
            assignee_name = @assignee_name, slabs_json = @slabs_json, notes = @notes,
            hide = @hide, status = @status, version = @version, updated_at = @updated_at
            WHERE id = @id AND tenant_id = @tenant_id`).run(row);
        } else {
          db.prepare(`INSERT INTO staff_target_incentive_master (
            id, tenant_id, branch_id, target_type, assignee_type, assignee_id, assignee_name,
            role_scope, slabs_json, notes, hide, status, version, created_by, created_at, updated_at
          ) VALUES (
            @id, @tenant_id, @branch_id, @target_type, @assignee_type, @assignee_id, @assignee_name,
            @role_scope, @slabs_json, @notes, @hide, @status, @version, @created_by, @created_at, @updated_at
          )`).run(row);
        }
        saved.push(rowToTargetIncentiveMaster(row));
      }
      this.writeAudit("staff.target_incentive_copied", "staff_target_incentive_master", id, access, { copiedTo: saved.map((item) => item.assigneeId), branchId: source.branch_id });
    })();
    this.emit("staff:target_incentive_copied", access, source.branch_id, id);
    return saved;
  }

  listServiceAssignmentMasters(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      staff_id: query.staffId || query.staff_id || "",
      role_scope: query.roleScope || query.role_scope || "",
      status: query.status || "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 500), 1000)
    };
    const filters = ["tenant_id = @tenant_id"];
    if (params.branch_id) filters.push("(branch_id = @branch_id OR branch_id = '')");
    if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
      filters.push("(branch_id = @access_branch_id OR branch_id = '')");
      params.access_branch_id = access.branchId;
    }
    if (params.staff_id) filters.push("staff_id = @staff_id");
    if (params.role_scope) {
      params.role_scope = normalizeTargetRoleScope(params.role_scope);
      filters.push("role_scope = @role_scope");
    }
    if (params.status) filters.push("status = @status");
    if (query.visibleOnly === "true" || query.visibleOnly === true) filters.push("hide = 0");
    if (params.q) filters.push("(lower(staff_name) LIKE @q OR lower(notes) LIKE @q OR lower(service_snapshot_json) LIKE @q)");
    return db.prepare(`SELECT * FROM staff_service_assignment_master WHERE ${filters.join(" AND ")}
      ORDER BY role_scope ASC, staff_name ASC LIMIT @limit`).all(params).map(rowToServiceAssignmentMaster);
  }

  getServiceAssignmentMaster(id, access) {
    access = normalizeAccess(access);
    const row = db.prepare("SELECT * FROM staff_service_assignment_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Employee service assignment not found");
    if (row.branch_id) assertBranch(access, row.branch_id);
    return rowToServiceAssignmentMaster(row);
  }

  createServiceAssignmentMaster(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const staff = this.getStaff(payload.staffId || payload.staff_id, access);
    const row = buildServiceAssignmentMasterPayload({ staffName: staff.fullName, branchId: staff.branchId, ...payload }, access);
    const existing = db.prepare(`SELECT id FROM staff_service_assignment_master
      WHERE tenant_id = ? AND branch_id = ? AND staff_id = ? AND role_scope = ?`)
      .get(row.tenant_id, row.branch_id, row.staff_id, row.role_scope);
    if (existing) throw conflict("Service assignment already exists for this employee");
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_service_assignment_master (
        id, tenant_id, branch_id, staff_id, staff_name, role_scope, service_ids_json,
        service_snapshot_json, category_filter_json, hide, notes, status, version,
        created_by, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @staff_id, @staff_name, @role_scope, @service_ids_json,
        @service_snapshot_json, @category_filter_json, @hide, @notes, @status, @version,
        @created_by, @created_at, @updated_at
      )`).run(row);
      this.writeAudit("staff.service_assignment_created", "staff_service_assignment_master", row.id, access, { after: row, branchId: row.branch_id });
    })();
    this.emit("staff:service_assignment_created", access, row.branch_id, row.id);
    return this.getServiceAssignmentMaster(row.id, access);
  }

  updateServiceAssignmentMaster(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_service_assignment_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Employee service assignment not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version || 1)) throw conflict("Service assignment has been updated by another request");
    const next = buildServiceAssignmentMasterPayload(payload, access, existing);
    db.transaction(() => {
      db.prepare(`UPDATE staff_service_assignment_master SET
        branch_id = @branch_id, staff_id = @staff_id, staff_name = @staff_name, role_scope = @role_scope,
        service_ids_json = @service_ids_json, service_snapshot_json = @service_snapshot_json,
        category_filter_json = @category_filter_json, hide = @hide, notes = @notes,
        status = @status, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.service_assignment_updated", "staff_service_assignment_master", id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    this.emit("staff:service_assignment_updated", access, next.branch_id, id);
    return this.getServiceAssignmentMaster(id, access);
  }

  updateServiceAssignmentMasterStatus(id, payload = {}, access) {
    return this.updateServiceAssignmentMaster(id, {
      status: payload.status,
      hide: payload.hide,
      version: payload.version
    }, access);
  }

  copyServiceAssignmentMaster(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const source = db.prepare("SELECT * FROM staff_service_assignment_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!source) throw notFound("Employee service assignment not found");
    if (source.branch_id) assertBranch(access, source.branch_id);
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    if (!targets.length) throw badRequest("targets are required for Save & Copy To");
    const saved = [];
    db.transaction(() => {
      for (const target of targets.slice(0, 100)) {
        const candidate = {
          branchId: target.branchId ?? payload.branchId ?? source.branch_id,
          staffId: target.staffId ?? target.id,
          staffName: target.staffName ?? target.name ?? "",
          roleScope: target.roleScope ?? source.role_scope,
          serviceIds: parseJsonArray(source.service_ids_json),
          services: parseJsonArray(source.service_snapshot_json),
          categoryFilters: parseJsonArray(source.category_filter_json),
          notes: payload.notes ?? source.notes,
          hide: false,
          status: "active"
        };
        const existing = db.prepare(`SELECT * FROM staff_service_assignment_master
          WHERE tenant_id = ? AND branch_id = ? AND staff_id = ? AND role_scope = ?`)
          .get(access.tenantId, candidate.branchId, candidate.staffId, candidate.roleScope);
        const row = buildServiceAssignmentMasterPayload(candidate, access, existing || null);
        if (existing) {
          db.prepare(`UPDATE staff_service_assignment_master SET
            staff_name = @staff_name, service_ids_json = @service_ids_json,
            service_snapshot_json = @service_snapshot_json, category_filter_json = @category_filter_json,
            notes = @notes, hide = @hide, status = @status, version = @version, updated_at = @updated_at
            WHERE id = @id AND tenant_id = @tenant_id`).run(row);
        } else {
          db.prepare(`INSERT INTO staff_service_assignment_master (
            id, tenant_id, branch_id, staff_id, staff_name, role_scope, service_ids_json,
            service_snapshot_json, category_filter_json, hide, notes, status, version,
            created_by, created_at, updated_at
          ) VALUES (
            @id, @tenant_id, @branch_id, @staff_id, @staff_name, @role_scope, @service_ids_json,
            @service_snapshot_json, @category_filter_json, @hide, @notes, @status, @version,
            @created_by, @created_at, @updated_at
          )`).run(row);
        }
        saved.push(rowToServiceAssignmentMaster(row));
      }
      this.writeAudit("staff.service_assignment_copied", "staff_service_assignment_master", id, access, { copiedTo: saved.map((item) => item.staffId), branchId: source.branch_id });
    })();
    this.emit("staff:service_assignment_copied", access, source.branch_id, id);
    return saved;
  }

  listFinePenaltyMasters(query = {}, access) {
    return this.listSimpleMaster("staff_fine_penalty_master", rowToFinePenaltyMaster, query, access, ["name", "notes"]);
  }

  getFinePenaltyMaster(id, access) {
    return this.getSimpleMaster("staff_fine_penalty_master", rowToFinePenaltyMaster, id, access, "Fine/Penalty master not found");
  }

  createFinePenaltyMaster(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const row = buildFinePenaltyMasterPayload(payload, access);
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_fine_penalty_master (
        id, tenant_id, branch_id, name, amount, amount_paise, rule_type, rule_label, trigger_count, apply_mode, auto_deduct, hide, notes, status, version, created_by, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @name, @amount, @amount_paise, @rule_type, @rule_label, @trigger_count, @apply_mode, @auto_deduct, @hide, @notes, @status, @version, @created_by, @created_at, @updated_at
      )`).run(row);
      this.writeAudit("staff.fine_penalty_created", "staff_fine_penalty_master", row.id, access, { after: row, branchId: row.branch_id });
    })();
    return this.getFinePenaltyMaster(row.id, access);
  }

  updateFinePenaltyMaster(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_fine_penalty_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Fine/Penalty master not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version || 1)) throw conflict("Fine/Penalty master has been updated by another request");
    const next = buildFinePenaltyMasterPayload(payload, access, existing);
    db.transaction(() => {
      db.prepare(`UPDATE staff_fine_penalty_master SET branch_id = @branch_id, name = @name, amount = @amount,
        amount_paise = @amount_paise, rule_type = @rule_type, rule_label = @rule_label, trigger_count = @trigger_count,
        apply_mode = @apply_mode, auto_deduct = @auto_deduct, hide = @hide, notes = @notes,
        status = @status, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.fine_penalty_updated", "staff_fine_penalty_master", id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    return this.getFinePenaltyMaster(id, access);
  }

  updateFinePenaltyMasterStatus(id, payload = {}, access) {
    return this.updateFinePenaltyMaster(id, { status: payload.status, hide: payload.hide, version: payload.version }, access);
  }

  listAllowanceDeductionMasters(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      entry_type: query.entryType || query.entry_type || query.type || "",
      status: query.status || "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 200), 500)
    };
    const filters = ["tenant_id = @tenant_id"];
    if (params.branch_id) filters.push("(branch_id = @branch_id OR branch_id = '')");
    if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
      filters.push("(branch_id = @access_branch_id OR branch_id = '')");
      params.access_branch_id = access.branchId;
    }
    if (params.entry_type) {
      params.entry_type = normalizeAllowanceDeductionType(params.entry_type);
      filters.push("entry_type = @entry_type");
    }
    if (params.status) filters.push("status = @status");
    if (query.visibleOnly === "true" || query.visibleOnly === true) filters.push("hide = 0");
    if (params.q) filters.push("(lower(description) LIKE @q OR lower(notes) LIKE @q)");
    return db.prepare(`SELECT * FROM staff_allowance_deduction_master WHERE ${filters.join(" AND ")}
      ORDER BY entry_type ASC, hide ASC, description ASC LIMIT @limit`).all(params).map(rowToAllowanceDeductionMaster);
  }

  getAllowanceDeductionMaster(id, access) {
    return this.getSimpleMaster("staff_allowance_deduction_master", rowToAllowanceDeductionMaster, id, access, "Allowance/Deduction master not found");
  }

  createAllowanceDeductionMaster(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const row = buildAllowanceDeductionMasterPayload(payload, access);
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_allowance_deduction_master (
        id, tenant_id, branch_id, description, entry_type, hide, notes, status, version, created_by, created_at, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @description, @entry_type, @hide, @notes, @status, @version, @created_by, @created_at, @updated_at
      )`).run(row);
      this.writeAudit("staff.allowance_deduction_created", "staff_allowance_deduction_master", row.id, access, { after: row, branchId: row.branch_id });
    })();
    return this.getAllowanceDeductionMaster(row.id, access);
  }

  updateAllowanceDeductionMaster(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_allowance_deduction_master WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Allowance/Deduction master not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version || 1)) throw conflict("Allowance/Deduction master has been updated by another request");
    const next = buildAllowanceDeductionMasterPayload(payload, access, existing);
    db.transaction(() => {
      db.prepare(`UPDATE staff_allowance_deduction_master SET branch_id = @branch_id, description = @description,
        entry_type = @entry_type, hide = @hide, notes = @notes, status = @status, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.allowance_deduction_updated", "staff_allowance_deduction_master", id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    return this.getAllowanceDeductionMaster(id, access);
  }

  updateAllowanceDeductionMasterStatus(id, payload = {}, access) {
    return this.updateAllowanceDeductionMaster(id, { status: payload.status, hide: payload.hide, version: payload.version }, access);
  }

  listPayrollSalaryStructureMasters(query = {}, access) {
    return this.listSimpleMaster("staff_payroll_salary_structure_master", rowToPayrollSalaryStructureMaster, query, access, ["name", "notes"]);
  }

  getPayrollSalaryStructureMaster(id, access) {
    return this.getSimpleMaster("staff_payroll_salary_structure_master", rowToPayrollSalaryStructureMaster, id, access, "Payroll salary structure not found");
  }

  upsertPayrollSalaryStructureMaster(payload = {}, access) {
    access = normalizeAccess(access);
    requireRole(access, payrollRoles, "Only owner/admin/accountant can manage payroll salary structure");
    const existingById = payload.id ? db.prepare("SELECT * FROM staff_payroll_salary_structure_master WHERE id = ? AND tenant_id = ?").get(payload.id, access.tenantId) : null;
    const branchId = payload.branchId ?? payload.branch_id ?? existingById?.branch_id ?? access.requestedBranchId ?? "";
    if (branchId) assertBranch(access, branchId);
    const existing = existingById || db.prepare("SELECT * FROM staff_payroll_salary_structure_master WHERE tenant_id = ? AND branch_id = ?")
      .get(access.tenantId, branchId);
    if (existing && payload.version !== undefined && Number(payload.version) !== Number(existing.version || 1)) {
      throw conflict("Payroll salary structure has been updated by another request");
    }
    const row = buildPayrollSalaryStructurePayload({ ...payload, branchId }, access, existing || null);
    db.transaction(() => {
      if (existing) {
        db.prepare(`UPDATE staff_payroll_salary_structure_master SET name = @name,
          provident_fund_json = @provident_fund_json, professional_tax_json = @professional_tax_json,
          esic_json = @esic_json, tds_json = @tds_json, hide = @hide, notes = @notes,
          status = @status, version = @version, updated_at = @updated_at
          WHERE id = @id AND tenant_id = @tenant_id`).run(row);
      } else {
        db.prepare(`INSERT INTO staff_payroll_salary_structure_master (
          id, tenant_id, branch_id, name, provident_fund_json, professional_tax_json, esic_json,
          tds_json, hide, notes, status, version, created_by, created_at, updated_at
        ) VALUES (
          @id, @tenant_id, @branch_id, @name, @provident_fund_json, @professional_tax_json, @esic_json,
          @tds_json, @hide, @notes, @status, @version, @created_by, @created_at, @updated_at
        )`).run(row);
      }
      this.writeAudit("staff.payroll_structure_upserted", "staff_payroll_salary_structure_master", row.id, access, { before: existing, after: row, branchId: row.branch_id });
    })();
    return this.getPayrollSalaryStructureMaster(row.id, access);
  }

  updatePayrollSalaryStructureMasterStatus(id, payload = {}, access) {
    const existing = this.getPayrollSalaryStructureMaster(id, access);
    return this.upsertPayrollSalaryStructureMaster({
      ...existing,
      branchId: existing.branchId,
      status: payload.status,
      hide: payload.hide,
      version: payload.version
    }, access);
  }

  listBulkEmployeeUpdateRows(query = {}, access) {
    const rows = this.listStaff({ ...query, includeArchived: "true", limit: query.limit || 1000 }, access);
    return rows.map((staff) => {
      const salary = staff.employeeDetails?.attendanceSalary || {};
      return {
        staffId: staff.id,
        version: staff.version,
        employeeName: staff.fullName,
        shortName: staff.employeeDetails?.shortName || "",
        branchId: staff.branchId || "",
        type: staff.staffCategoryScope || staff.employmentType || "",
        categoryId: staff.staffCategoryId || "",
        categoryName: staff.staffCategoryName || "",
        designation: staff.designation || "",
        joiningDate: staff.joiningDate || "",
        leftDate: staff.employeeDetails?.lastWorkingDate || "",
        hide: Boolean(staff.employeeDetails?.hideFromRoster || staff.status === "archived" || staff.status === "inactive"),
        dateOfBirth: staff.dob || "",
        anniversaryDate: staff.employeeDetails?.anniversaryDate || "",
        gender: staff.gender || "",
        panNo: salary.panNo || salary.pan_no || "",
        aadharNo: salary.aadharNo || salary.aadhar_no || ""
      };
    });
  }

  applyBulkEmployeeUpdate(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) throw badRequest("rows are required");
    const branchId = payload.branchId || payload.branch_id || "";
    if (branchId) assertBranch(access, branchId);
    const results = [];
    let savedJob = null;
    db.transaction(() => {
      for (const row of rows.slice(0, 1000)) {
        try {
          const staffId = row.staffId || row.staff_id || row.id;
          const existing = db.prepare("SELECT * FROM staff_master WHERE id = ? AND tenant_id = ?").get(staffId, access.tenantId);
          if (!existing) throw notFound("Staff record not found");
          assertBranch(access, existing.branch_id);
          if (row.version === undefined) throw badRequest("version is required");
          if (Number(row.version) !== Number(existing.version || 1)) throw conflict("Staff record has been updated by another request");
          const nextBranchId = row.branchId ?? row.branch_id ?? existing.branch_id;
          assertBranch(access, nextBranchId);
          const fullName = String(row.employeeName ?? row.fullName ?? row.full_name ?? existing.full_name).trim();
          const parts = fullName.split(/\s+/).filter(Boolean);
          const fallbackLastName = parts.slice(1).join(" ") || existing.last_name;
          const next = {
            id: existing.id,
            tenant_id: access.tenantId,
            branch_id: nextBranchId,
            employee_code: row.employeeCode ?? row.employee_code ?? existing.employee_code,
            first_name: row.firstName ?? row.first_name ?? parts[0] ?? existing.first_name,
            last_name: row.lastName ?? row.last_name ?? fallbackLastName,
            full_name: fullName || existing.full_name,
            gender: row.gender ?? existing.gender,
            dob: row.dateOfBirth ?? row.dob ?? existing.dob,
            joining_date: row.joiningDate ?? row.joining_date ?? existing.joining_date,
            employment_type: row.employmentType ?? row.employment_type ?? (["full_time", "part_time", "contract"].includes(row.type) ? row.type : existing.employment_type),
            designation: row.designation ?? existing.designation,
            status: row.hide === true ? "inactive" : row.hide === false && existing.status === "inactive" ? "active" : row.status ?? existing.status,
            version: Number(existing.version || 1) + 1,
            updated_at: now()
          };
          db.prepare(`UPDATE staff_master SET branch_id = @branch_id, employee_code = @employee_code,
            first_name = @first_name, last_name = @last_name, full_name = @full_name, gender = @gender,
            dob = @dob, joining_date = @joining_date, employment_type = @employment_type,
            designation = @designation, status = @status,
            version = @version, updated_at = @updated_at
            WHERE id = @id AND tenant_id = @tenant_id`).run(next);
          if (row.categoryId !== undefined || row.staffCategoryId !== undefined) {
            this.assignStaffCategory(existing.id, row.categoryId ?? row.staffCategoryId ?? "", nextBranchId, access);
          }
          const currentDetails = this.getStaffEmployeeDetails(existing.id, access, true);
          const currentSalary = currentDetails?.attendanceSalary || {};
          this.upsertStaffEmployeeDetails(existing.id, nextBranchId, {
            employeeDetails: {
              shortName: row.shortName ?? currentDetails?.shortName ?? "",
              lastWorkingDate: row.leftDate ?? row.lastWorkingDate ?? currentDetails?.lastWorkingDate ?? "",
              anniversaryDate: row.anniversaryDate ?? currentDetails?.anniversaryDate ?? "",
              hideFromRoster: row.hide !== undefined ? Boolean(row.hide) : Boolean(currentDetails?.hideFromRoster),
              attendanceSalary: {
                ...currentSalary,
                panNo: row.panNo ?? currentSalary.panNo ?? "",
                aadharNo: row.aadharNo ?? row.aadhaarNo ?? currentSalary.aadharNo ?? ""
              }
            }
          }, access);
          results.push({ staffId: existing.id, status: "updated", version: next.version });
          this.writeAudit("staff.bulk_employee_updated", "staff_master", existing.id, access, { before: existing, after: next, branchId: nextBranchId });
        } catch (error) {
          results.push({ staffId: row.staffId || row.staff_id || row.id || "", status: "failed", error: error.message || "Update failed" });
        }
      }
      const job = {
        id: makeId("bulkemp"),
        tenant_id: access.tenantId,
        branch_id: branchId,
        total_rows: rows.length,
        updated_rows: results.filter((item) => item.status === "updated").length,
        failed_rows: results.filter((item) => item.status === "failed").length,
        results_json: json(results),
        requested_by: access.userId || "",
        status: results.some((item) => item.status === "failed") ? "completed_with_errors" : "completed",
        created_at: now()
      };
      db.prepare(`INSERT INTO staff_bulk_employee_update_jobs (
        id, tenant_id, branch_id, total_rows, updated_rows, failed_rows, results_json, requested_by, status, created_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @total_rows, @updated_rows, @failed_rows, @results_json, @requested_by, @status, @created_at
      )`).run(job);
      savedJob = rowToBulkEmployeeUpdateJob(job);
    })();
    return savedJob;
  }

  listSimpleMaster(table, mapper, query = {}, access, searchColumns = ["name", "notes"]) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      q: query.q ? `%${String(query.q).toLowerCase()}%` : "",
      limit: Math.min(parseNumber(query.limit, 200), 500)
    };
    const filters = ["tenant_id = @tenant_id"];
    if (params.branch_id) filters.push("(branch_id = @branch_id OR branch_id = '')");
    if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
      filters.push("(branch_id = @access_branch_id OR branch_id = '')");
      params.access_branch_id = access.branchId;
    }
    if (params.status) filters.push("status = @status");
    if (query.visibleOnly === "true" || query.visibleOnly === true) filters.push("hide = 0");
    if (params.q) filters.push(`(${searchColumns.map((column) => `lower(${column}) LIKE @q`).join(" OR ")})`);
    return db.prepare(`SELECT * FROM ${table} WHERE ${filters.join(" AND ")}
      ORDER BY hide ASC, updated_at DESC LIMIT @limit`).all(params).map(mapper);
  }

  getSimpleMaster(table, mapper, id, access, message) {
    access = normalizeAccess(access);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`).get(id, access.tenantId);
    if (!row) throw notFound(message);
    if (row.branch_id) assertBranch(access, row.branch_id);
    return mapper(row);
  }

  assignStaffCategory(staffId, categoryId, branchId, access) {
    const activeAssignments = db.prepare("SELECT * FROM staff_category_assignments WHERE tenant_id = ? AND staff_id = ? AND status = 'active'")
      .all(access.tenantId, staffId);
    if (!categoryId) {
      db.prepare("UPDATE staff_category_assignments SET status = 'inactive', version = version + 1, updated_at = ? WHERE tenant_id = ? AND staff_id = ? AND status = 'active'")
        .run(now(), access.tenantId, staffId);
      if (activeAssignments.length) this.writeAudit("staff.category_cleared", "staff_category_assignments", staffId, access, { before: activeAssignments, branchId });
      return null;
    }
    const category = db.prepare("SELECT * FROM staff_categories WHERE id = ? AND tenant_id = ? AND status = 'active'").get(categoryId, access.tenantId);
    if (!category) throw badRequest("Active staff category is required");
    if (category.branch_id && category.branch_id !== branchId) throw badRequest("Staff category does not belong to selected branch");
    db.prepare("UPDATE staff_category_assignments SET status = 'inactive', version = version + 1, updated_at = ? WHERE tenant_id = ? AND staff_id = ? AND status = 'active'")
      .run(now(), access.tenantId, staffId);
    const existing = db.prepare("SELECT * FROM staff_category_assignments WHERE tenant_id = ? AND staff_id = ? AND category_id = ?")
      .get(access.tenantId, staffId, categoryId);
    const row = {
      id: existing?.id || makeId("scas"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      staff_id: staffId,
      category_id: categoryId,
      assigned_at: now(),
      status: "active",
      version: Number(existing?.version || 0) + 1,
      created_at: existing?.created_at || now(),
      updated_at: now()
    };
    if (existing) {
      db.prepare(`UPDATE staff_category_assignments SET branch_id = @branch_id, assigned_at = @assigned_at, status = @status,
        version = @version, updated_at = @updated_at WHERE id = @id AND tenant_id = @tenant_id`).run(row);
    } else {
      db.prepare(`INSERT INTO staff_category_assignments (id, tenant_id, branch_id, staff_id, category_id, assigned_at, status, version, created_at, updated_at)
        VALUES (@id, @tenant_id, @branch_id, @staff_id, @category_id, @assigned_at, @status, @version, @created_at, @updated_at)`).run(row);
    }
    this.writeAudit("staff.category_assigned", "staff_category_assignments", row.id, access, { before: activeAssignments, after: row, branchId });
    return rowToCamel(row);
  }

  addStaffDocument(staffId, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const staff = this.getStaff(staffId, access);
    const row = {
      id: makeId("sdoc"),
      tenant_id: access.tenantId,
      staff_id: staffId,
      document_type: payload.documentType || payload.document_type || "",
      document_url: payload.documentUrl || payload.document_url || "",
      verification_status: payload.verificationStatus || payload.verification_status || "pending",
      expiry_date: payload.expiryDate || payload.expiry_date || ""
    };
    db.prepare(`INSERT INTO staff_documents (id, tenant_id, staff_id, document_type, document_url, verification_status, expiry_date)
      VALUES (@id, @tenant_id, @staff_id, @document_type, @document_url, @verification_status, @expiry_date)`).run(row);
    this.writeAudit("staff.document_added", "staff_documents", row.id, access, { after: row, branchId: staff.branchId });
    return rowToCamel(row);
  }

  addStaffSkill(staffId, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const staff = this.getStaff(staffId, access);
    const row = {
      id: makeId("sskill"),
      tenant_id: access.tenantId,
      staff_id: staffId,
      service_id: payload.serviceId || payload.service_id || "",
      skill_level: payload.skillLevel || payload.skill_level || "trained",
      years_experience: parseNumber(payload.yearsExperience ?? payload.years_experience, 0),
      certified: payload.certified ? 1 : 0,
      certification_expiry: payload.certificationExpiry || payload.certification_expiry || "",
      notes: payload.notes || ""
    };
    if (!row.service_id) throw badRequest("serviceId is required");
    db.prepare(`INSERT OR REPLACE INTO staff_skills (id, tenant_id, staff_id, service_id, skill_level, years_experience, certified, certification_expiry, notes)
      VALUES (@id, @tenant_id, @staff_id, @service_id, @skill_level, @years_experience, @certified, @certification_expiry, @notes)`).run(row);
    this.writeAudit("staff.skill_added", "staff_skills", row.id, access, { after: row, branchId: staff.branchId });
    return rowToCamel(row);
  }

  listSchedules(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      staff_id: query.staffId || query.staff_id || "",
      from: query.from || query.dateFrom || "",
      to: query.to || query.dateTo || "",
      limit: Math.min(parseNumber(query.limit, 100), 500)
    };
    const filters = [branchScopedWhere(access, params)];
    if (params.staff_id) filters.push("staff_id = @staff_id");
    if (params.from) filters.push("schedule_date >= @from");
    if (params.to) filters.push("schedule_date <= @to");
    return db.prepare(`SELECT * FROM staff_schedules WHERE ${filters.join(" AND ")} ORDER BY schedule_date, start_time LIMIT @limit`).all(params).map(rowToCamel);
  }

  createSchedule(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const branchId = pickBranch(payload, access);
    assertBranch(access, branchId);
    if (!payload.staffId && !payload.staff_id) throw badRequest("staffId is required");
    const staff = this.getStaff(payload.staffId || payload.staff_id, access);
    const row = {
      id: makeId("sched"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      staff_id: staff.id,
      schedule_date: payload.scheduleDate || payload.schedule_date || payload.date || businessDate(),
      start_time: payload.startTime || payload.start_time || "",
      end_time: payload.endTime || payload.end_time || "",
      shift_type: payload.shiftType || payload.shift_type || "regular",
      recurrence_rule: payload.recurrenceRule || payload.recurrence_rule || "",
      status: payload.status || "scheduled",
      notes: payload.notes || "",
      created_by: access.userId || ""
    };
    if (!row.start_time || !row.end_time) throw badRequest("startTime and endTime are required");
    const trx = db.transaction(() => {
      db.prepare(`INSERT INTO staff_schedules (id, tenant_id, branch_id, staff_id, schedule_date, start_time, end_time, shift_type, recurrence_rule, status, notes, created_by)
        VALUES (@id, @tenant_id, @branch_id, @staff_id, @schedule_date, @start_time, @end_time, @shift_type, @recurrence_rule, @status, @notes, @created_by)`).run(row);
      this.writeAudit("staff.schedule_created", "staff_schedules", row.id, access, { after: row, branchId });
      return rowToCamel(db.prepare("SELECT * FROM staff_schedules WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
    });
    const schedule = trx();
    this.emit("staff:shift_created", access, branchId, row.id);
    this.queueRosterNotifications(schedule, staff, access);
    return schedule;
  }

  queueRosterNotifications(schedule = {}, staff = {}, access = {}) {
    const branchId = schedule.branchId || staff.branchId || access.branchId || "";
    const copy = rosterNotificationCopy(schedule, staff);
    const metadata = {
      scheduleId: schedule.id,
      staffId: staff.id,
      scheduleDate: schedule.scheduleDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      source: "staff-roster"
    };
    const preference = db.prepare("SELECT * FROM staff_notification_preferences WHERE tenant_id = ? AND staff_id = ?").get(access.tenantId, staff.id) || {};
    const targets = [
      {
        channel: "whatsapp",
        recipient: Number(preference.whatsapp_opt_in ?? 1) === 1 ? firstStaffPhone(staff) : "",
        jobType: "whatsapp_send",
        payload: {
          phone: firstStaffPhone(staff),
          body: copy.body,
          branchId,
          source: "staff-roster",
          eventType: "staff_roster_created",
          refId: schedule.id,
          variables: {
            client_name: staff.fullName || staff.firstName || "Staff",
            staff_name: staff.fullName || staff.firstName || "Staff",
            date: formatRosterDate(schedule.scheduleDate),
            time: `${schedule.startTime || ""} - ${schedule.endTime || ""}`.trim()
          }
        }
      },
      {
        channel: "email",
        recipient: firstStaffEmail(staff),
        jobType: "email_send",
        payload: {
          to: firstStaffEmail(staff),
          subject: copy.subject,
          message: copy.body,
          body: copy.body,
          branchId,
          staffId: staff.id,
          type: "staff_roster_created",
          refId: schedule.id
        }
      }
    ];

    for (const target of targets) {
      if (!target.recipient) continue;
      try {
        const job = jobQueueService.enqueue({
          tenantId: access.tenantId,
          jobType: target.jobType,
          payload: target.payload,
          priority: 3
        });
        const row = {
          id: makeId("snotif"),
          tenant_id: access.tenantId,
          branch_id: branchId,
          staff_id: staff.id,
          notification_type: "staff_roster_created",
          template_id: "",
          channel: target.channel,
          language: preference.language || "en-IN",
          message_preview: copy.body,
          sensitive: 0,
          requires_approval: 0,
          status: "queued",
          quiet_hours_deferred: 0,
          scheduled_at: now(),
          metadata_json: json({ ...metadata, jobId: job.id, channel: target.channel }),
          created_by: access.userId || ""
        };
        db.prepare(`INSERT INTO staff_notification_queue
          (id, tenant_id, branch_id, staff_id, notification_type, template_id, channel, language, message_preview, sensitive, requires_approval, status, quiet_hours_deferred, scheduled_at, metadata_json, created_by)
          VALUES (@id, @tenant_id, @branch_id, @staff_id, @notification_type, @template_id, @channel, @language, @message_preview, @sensitive, @requires_approval, @status, @quiet_hours_deferred, @scheduled_at, @metadata_json, @created_by)`).run(row);
        this.writeAudit("staff.roster_notification_queued", "staff_notification_queue", row.id, access, { after: row, branchId });
      } catch (error) {
        try {
          this.writeAudit("staff.roster_notification_failed", "staff_schedules", schedule.id, access, {
            branchId,
            details: { channel: target.channel, error: String(error?.message || error).slice(0, 250) }
          });
        } catch {
          // Notification delivery is best-effort after roster creation succeeds.
        }
      }
    }
  }

  updateSchedule(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_schedules WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Schedule not found");
    assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version)) throw conflict("Schedule was updated by another request");
    const branchId = pickBranch(payload, access) || existing.branch_id;
    assertBranch(access, branchId);
    const next = {
      id,
      tenant_id: access.tenantId,
      branch_id: branchId,
      staff_id: payload.staffId || payload.staff_id || existing.staff_id,
      schedule_date: payload.scheduleDate || payload.schedule_date || payload.date || existing.schedule_date,
      start_time: payload.startTime || payload.start_time || existing.start_time,
      end_time: payload.endTime || payload.end_time || existing.end_time,
      shift_type: payload.shiftType || payload.shift_type || existing.shift_type,
      recurrence_rule: payload.recurrenceRule || payload.recurrence_rule || existing.recurrence_rule,
      status: payload.status || existing.status,
      notes: payload.notes ?? existing.notes,
      version: Number(existing.version || 1) + 1,
      updated_at: now()
    };
    const trx = db.transaction(() => {
      db.prepare(`UPDATE staff_schedules SET branch_id = @branch_id, staff_id = @staff_id, schedule_date = @schedule_date,
        start_time = @start_time, end_time = @end_time, shift_type = @shift_type, recurrence_rule = @recurrence_rule,
        status = @status, notes = @notes, version = @version, updated_at = @updated_at
        WHERE id = @id AND tenant_id = @tenant_id`).run(next);
      this.writeAudit("staff.schedule_updated", "staff_schedules", id, access, { before: existing, after: next, branchId });
      return rowToCamel(db.prepare("SELECT * FROM staff_schedules WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
    });
    const schedule = trx();
    this.emit("staff:shift_updated", access, branchId, id);
    return schedule;
  }

  deleteSchedule(id, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const existing = db.prepare("SELECT * FROM staff_schedules WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Schedule not found");
    assertBranch(access, existing.branch_id);
    db.transaction(() => {
      db.prepare("DELETE FROM staff_schedules WHERE id = ? AND tenant_id = ?").run(id, access.tenantId);
      this.writeAudit("staff.schedule_deleted", "staff_schedules", id, access, { before: existing, branchId: existing.branch_id });
    })();
    this.emit("staff:shift_updated", access, existing.branch_id, id);
    return { id, deleted: true };
  }

  createShiftSwap(payload = {}, access) {
    access = normalizeAccess(access);
    const schedule = db.prepare("SELECT * FROM staff_schedules WHERE id = ? AND tenant_id = ?").get(payload.scheduleId || payload.schedule_id, access.tenantId);
    if (!schedule) throw notFound("Schedule not found");
    assertBranch(access, schedule.branch_id);
    const row = {
      id: makeId("swap"),
      tenant_id: access.tenantId,
      branch_id: schedule.branch_id,
      schedule_id: schedule.id,
      from_staff_id: payload.fromStaffId || payload.from_staff_id || schedule.staff_id,
      to_staff_id: payload.toStaffId || payload.to_staff_id || "",
      reason: payload.reason || "",
      status: "pending"
    };
    if (!row.to_staff_id) throw badRequest("toStaffId is required");
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_shift_swaps (id, tenant_id, branch_id, schedule_id, from_staff_id, to_staff_id, reason, status)
        VALUES (@id, @tenant_id, @branch_id, @schedule_id, @from_staff_id, @to_staff_id, @reason, @status)`).run(row);
      this.writeAudit("staff.shift_swap_requested", "staff_shift_swaps", row.id, access, { after: row, branchId: row.branch_id });
    })();
    this.emit("staff:shift_swap_requested", access, row.branch_id, row.id);
    return rowToCamel(db.prepare("SELECT * FROM staff_shift_swaps WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  approveShiftSwap(id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const swap = db.prepare("SELECT * FROM staff_shift_swaps WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!swap) throw notFound("Shift swap not found");
    assertBranch(access, swap.branch_id);
    if (payload.version !== undefined && Number(payload.version) !== Number(swap.version)) throw conflict("Shift swap was updated by another request");
    const stamp = now();
    db.transaction(() => {
      db.prepare(`UPDATE staff_shift_swaps SET status = 'approved', approved_by = ?, approved_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND tenant_id = ?`).run(access.userId || "", stamp, stamp, id, access.tenantId);
      db.prepare(`UPDATE staff_schedules SET staff_id = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND tenant_id = ?`).run(swap.to_staff_id, stamp, swap.schedule_id, access.tenantId);
      this.writeAudit("staff.shift_swap_approved", "staff_shift_swaps", id, access, { before: swap, branchId: swap.branch_id });
    })();
    this.emit("staff:shift_swap_approved", access, swap.branch_id, id);
    return rowToCamel(db.prepare("SELECT * FROM staff_shift_swaps WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
  }

  branchTransfer(payload = {}, access) {
    return this.updateStaff(payload.staffId || payload.staff_id, {
      branchId: payload.toBranchId || payload.to_branch_id,
      version: payload.version,
      notes: payload.reason || payload.notes
    }, access);
  }

  clockIn(payload = {}, access) {
    return this.createAttendanceEvent("clock_in", payload, access);
  }

  clockOut(payload = {}, access) {
    return this.closeAttendance(payload, access);
  }

  createAttendanceEvent(kind, payload = {}, access) {
    access = normalizeAccess(access);
    const staff = this.resolveMobileStaff(payload, access);
    const branchId = pickBranch(payload, access) || staff.branchId;
    assertBranch(access, branchId);
    const date = payload.businessDate || payload.business_date || businessDate();
    const existing = db.prepare(`SELECT * FROM staff_attendance_logs
      WHERE tenant_id = ? AND staff_id = ? AND business_date = ? AND status = 'clocked_in'
      ORDER BY created_at DESC LIMIT 1`).get(access.tenantId, staff.id, date);
    if (existing) throw conflict("Staff is already clocked in for this date");
    const row = {
      id: makeId("att"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      staff_id: staff.id,
      business_date: date,
      clock_in_at: payload.clockInAt || payload.clock_in_at || now(),
      source: payload.source || "manual",
      gps_lat: payload.gpsLat ?? payload.gps_lat ?? null,
      gps_lng: payload.gpsLng ?? payload.gps_lng ?? null,
      device_id: payload.deviceId || payload.device_id || "",
      selfie_url: payload.selfieUrl || payload.selfie_url || ""
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_attendance_logs (id, tenant_id, branch_id, staff_id, business_date, clock_in_at, source, gps_lat, gps_lng, device_id, selfie_url)
        VALUES (@id, @tenant_id, @branch_id, @staff_id, @business_date, @clock_in_at, @source, @gps_lat, @gps_lng, @device_id, @selfie_url)`).run(row);
      this.writeAudit("staff.clocked_in", "staff_attendance_logs", row.id, access, { after: row, branchId });
    })();
    this.emit("staff:clocked_in", access, branchId, row.id);
    return rowToCamel(db.prepare("SELECT * FROM staff_attendance_logs WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  closeAttendance(payload = {}, access) {
    access = normalizeAccess(access);
    const staff = this.resolveMobileStaff(payload, access);
    const attendance = payload.attendanceId || payload.attendance_id
      ? db.prepare("SELECT * FROM staff_attendance_logs WHERE id = ? AND tenant_id = ?").get(payload.attendanceId || payload.attendance_id, access.tenantId)
      : db.prepare(`SELECT * FROM staff_attendance_logs WHERE tenant_id = ? AND staff_id = ? AND status = 'clocked_in'
          ORDER BY created_at DESC LIMIT 1`).get(access.tenantId, staff.id);
    if (!attendance) throw notFound("Active attendance record not found");
    assertBranch(access, attendance.branch_id);
    const stamp = payload.clockOutAt || payload.clock_out_at || now();
    db.transaction(() => {
      db.prepare(`UPDATE staff_attendance_logs SET clock_out_at = ?, status = 'clocked_out', overtime_minutes = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND tenant_id = ?`).run(stamp, parseNumber(payload.overtimeMinutes ?? payload.overtime_minutes, 0), stamp, attendance.id, access.tenantId);
      this.writeAudit("staff.clocked_out", "staff_attendance_logs", attendance.id, access, { before: attendance, after: { clock_out_at: stamp }, branchId: attendance.branch_id });
    })();
    this.emit("staff:clocked_out", access, attendance.branch_id, attendance.id);
    return rowToCamel(db.prepare("SELECT * FROM staff_attendance_logs WHERE id = ? AND tenant_id = ?").get(attendance.id, access.tenantId));
  }

  startBreak(payload = {}, access) {
    return this.breakEvent("start", payload, access);
  }

  endBreak(payload = {}, access) {
    return this.breakEvent("end", payload, access);
  }

  breakEvent(action, payload = {}, access) {
    access = normalizeAccess(access);
    if (action === "start") {
      const staff = this.resolveMobileStaff(payload, access);
      const attendance = db.prepare(`SELECT * FROM staff_attendance_logs WHERE tenant_id = ? AND staff_id = ? AND status = 'clocked_in'
        ORDER BY created_at DESC LIMIT 1`).get(access.tenantId, staff.id);
      if (!attendance) throw notFound("Active attendance record not found");
      assertBranch(access, attendance.branch_id);
      const row = {
        id: makeId("break"),
        tenant_id: access.tenantId,
        attendance_id: attendance.id,
        staff_id: staff.id,
        branch_id: attendance.branch_id,
        break_type: payload.breakType || payload.break_type || "regular",
        started_at: payload.startedAt || payload.started_at || now()
      };
      db.prepare(`INSERT INTO staff_breaks (id, tenant_id, attendance_id, staff_id, branch_id, break_type, started_at)
        VALUES (@id, @tenant_id, @attendance_id, @staff_id, @branch_id, @break_type, @started_at)`).run(row);
      this.emit("staff:break_started", access, row.branch_id, row.id);
      return rowToCamel(db.prepare("SELECT * FROM staff_breaks WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
    }
    const row = payload.breakId || payload.break_id
      ? db.prepare("SELECT * FROM staff_breaks WHERE id = ? AND tenant_id = ?").get(payload.breakId || payload.break_id, access.tenantId)
      : db.prepare(`SELECT * FROM staff_breaks WHERE tenant_id = ? AND staff_id = ? AND status = 'active'
          ORDER BY created_at DESC LIMIT 1`).get(access.tenantId, payload.staffId || payload.staff_id || access.userId);
    if (!row) throw notFound("Active break not found");
    assertBranch(access, row.branch_id);
    const endedAt = payload.endedAt || payload.ended_at || now();
    db.prepare("UPDATE staff_breaks SET ended_at = ?, status = 'ended' WHERE id = ? AND tenant_id = ?").run(endedAt, row.id, access.tenantId);
    this.emit("staff:break_ended", access, row.branch_id, row.id);
    return rowToCamel(db.prepare("SELECT * FROM staff_breaks WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  listAttendance(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      staff_id: query.staffId || query.staff_id || "",
      from: query.from || query.dateFrom || "",
      to: query.to || query.dateTo || "",
      limit: Math.min(parseNumber(query.limit, 100), 500)
    };
    const filters = [branchScopedWhere(access, params)];
    if (params.staff_id) filters.push("staff_id = @staff_id");
    if (params.from) filters.push("business_date >= @from");
    if (params.to) filters.push("business_date <= @to");
    return db.prepare(`SELECT * FROM staff_attendance_logs WHERE ${filters.join(" AND ")} ORDER BY business_date DESC, created_at DESC LIMIT @limit`).all(params).map(rowToCamel);
  }

  correctAttendance(payload = {}, access) {
    access = normalizeAccess(access);
    requireRole(access, attendanceCorrectionRoles, "Only manager/admin/owner can correct attendance");
    const attendance = db.prepare("SELECT * FROM staff_attendance_logs WHERE id = ? AND tenant_id = ?").get(payload.attendanceId || payload.attendance_id, access.tenantId);
    if (!attendance) throw notFound("Attendance record not found");
    assertBranch(access, attendance.branch_id);
    const row = {
      id: makeId("corr"),
      tenant_id: access.tenantId,
      attendance_id: attendance.id,
      staff_id: attendance.staff_id,
      branch_id: attendance.branch_id,
      requested_by: access.userId || "",
      approved_by: access.userId || "",
      reason: payload.reason || "",
      old_value: json(attendance),
      new_value: json(payload.patch || payload.newValue || {}),
      status: payload.status || "approved"
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO attendance_corrections (id, tenant_id, attendance_id, staff_id, branch_id, requested_by, approved_by, reason, old_value, new_value, status)
        VALUES (@id, @tenant_id, @attendance_id, @staff_id, @branch_id, @requested_by, @approved_by, @reason, @old_value, @new_value, @status)`).run(row);
      this.writeAudit("staff.attendance_corrected", "attendance_corrections", row.id, access, { before: attendance, after: payload.patch || {}, branchId: attendance.branch_id });
    })();
    return rowToCamel(db.prepare("SELECT * FROM attendance_corrections WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  requestLeave(payload = {}, access) {
    access = normalizeAccess(access);
    const staff = this.resolveMobileStaff(payload, access);
    const branchId = pickBranch(payload, access) || staff.branchId;
    assertBranch(access, branchId);
    const row = {
      id: makeId("leave"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      staff_id: staff.id,
      leave_type: payload.leaveType || payload.leave_type || "casual",
      start_date: payload.startDate || payload.start_date || businessDate(),
      end_date: payload.endDate || payload.end_date || payload.startDate || businessDate(),
      reason: payload.reason || "",
      status: "pending"
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_leaves (id, tenant_id, branch_id, staff_id, leave_type, start_date, end_date, reason, status)
        VALUES (@id, @tenant_id, @branch_id, @staff_id, @leave_type, @start_date, @end_date, @reason, @status)`).run(row);
      this.writeAudit("staff.leave_requested", "staff_leaves", row.id, access, { after: row, branchId });
    })();
    this.emit("staff:leave_requested", access, branchId, row.id);
    return rowToCamel(db.prepare("SELECT * FROM staff_leaves WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  decideLeave(id, status, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    if (!["approved", "rejected"].includes(status)) throw badRequest("Unsupported leave decision");
    const leave = db.prepare("SELECT * FROM staff_leaves WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!leave) throw notFound("Leave request not found");
    assertBranch(access, leave.branch_id);
    if (payload.version !== undefined && Number(payload.version) !== Number(leave.version)) throw conflict("Leave request was updated by another request");
    if (leave.status === status) return rowToCamel(leave);
    const stamp = now();
    db.transaction(() => {
      db.prepare(`UPDATE staff_leaves SET status = ?, approved_by = ?, approved_at = ?, rejection_reason = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND tenant_id = ?`).run(status, access.userId || "", stamp, status === "rejected" ? payload.reason || "" : "", stamp, id, access.tenantId);
      db.prepare("DELETE FROM leave_calendar_events WHERE tenant_id = ? AND leave_id = ?").run(access.tenantId, leave.id);
      if (status === "approved") {
        const days = daysBetweenInclusive(leave.start_date, leave.end_date);
        const master = db.prepare(`SELECT leave_quota, quota_period FROM staff_leave_type_master
          WHERE tenant_id = ? AND code = ? AND (branch_id = ? OR branch_id = '')
          ORDER BY CASE WHEN branch_id = ? THEN 0 ELSE 1 END LIMIT 1`)
          .get(access.tenantId, leave.leave_type, leave.branch_id, leave.branch_id);
        const period = leaveBalancePeriod(leave.start_date, master?.quota_period || "yearly");
        const balance = db.prepare(`SELECT * FROM leave_balances
          WHERE tenant_id = ? AND staff_id = ? AND leave_type = ? AND period_start = ?`)
          .get(access.tenantId, leave.staff_id, leave.leave_type, period.start);
        if (balance) {
          db.prepare(`UPDATE leave_balances SET used = used + ?, balance = balance - ?, version = version + 1, updated_at = ?
            WHERE id = ? AND tenant_id = ?`).run(days, days, stamp, balance.id, access.tenantId);
        } else {
          const quota = parseNumber(master?.leave_quota, 0);
          db.prepare(`INSERT INTO leave_balances (id, tenant_id, staff_id, leave_type, balance, used, period_start, period_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(makeId("lvbal"), access.tenantId, leave.staff_id, leave.leave_type, quota - days, days, period.start, period.end);
        }
        for (const eventDate of dateRangeInclusive(leave.start_date, leave.end_date)) {
          db.prepare(`INSERT INTO leave_calendar_events (id, tenant_id, branch_id, leave_id, staff_id, event_date, status)
            VALUES (?, ?, ?, ?, ?, ?, 'approved')`).run(makeId("lcal"), access.tenantId, leave.branch_id, leave.id, leave.staff_id, eventDate);
        }
      }
      this.writeAudit(`staff.leave_${status}`, "staff_leaves", id, access, { before: leave, after: { status }, branchId: leave.branch_id });
    })();
    this.emit(status === "approved" ? "staff:leave_approved" : "staff:leave_rejected", access, leave.branch_id, id);
    return rowToCamel(db.prepare("SELECT * FROM staff_leaves WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
  }

  listLeaves(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      staff_id: query.staffId || query.staff_id || "",
      status: query.status || "",
      from: query.from || query.startDate || query.start_date || query.dateFrom || "",
      to: query.to || query.endDate || query.end_date || query.dateTo || "",
      limit: Math.min(parseNumber(query.limit, 100), 500)
    };
    const filters = [branchScopedWhere(access, params)];
    if (params.staff_id) filters.push("staff_id = @staff_id");
    if (params.status) filters.push("status = @status");
    if (params.from) filters.push("end_date >= @from");
    if (params.to) filters.push("start_date <= @to");
    return db.prepare(`SELECT *,
      MAX(1, CAST(julianday(end_date) - julianday(start_date) + 1 AS INTEGER)) AS days,
      MAX(1, CAST(julianday(end_date) - julianday(start_date) + 1 AS INTEGER)) AS value
      FROM staff_leaves WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT @limit`).all(params).map(rowToCamel);
  }

  leaveBalances(query = {}, access) {
    access = normalizeAccess(access);
    const rows = db.prepare(`SELECT * FROM leave_balances WHERE tenant_id = ? AND (? = '' OR staff_id = ?) ORDER BY leave_type`)
      .all(access.tenantId, query.staffId || "", query.staffId || "");
    return rows.map(rowToCamel);
  }

  generatePayroll(payload = {}, access) {
    access = normalizeAccess(access);
    requireRole(access, payrollRoles, "Payroll can be generated only by owner/admin/accountant");
    const branchId = pickBranch(payload, access);
    if (branchId) assertBranch(access, branchId);
    const periodStart = payload.periodStart || payload.period_start;
    const periodEnd = payload.periodEnd || payload.period_end;
    if (!periodStart || !periodEnd) throw badRequest("periodStart and periodEnd are required");
    let staffRows = this.listStaff({ branchId, status: "active", limit: 500 }, access);
    const payloadRows = Array.isArray(payload.payrollRows) ? payload.payrollRows : [];
    const payloadRowsByStaff = new Map(payloadRows.map((row) => [String(row.staffId || row.staff_id || ""), row]));
    if (payloadRows.length) staffRows = staffRows.filter((staff) => payloadRowsByStaff.has(String(staff.id)));
    if (payloadRows.length && !staffRows.length) throw badRequest("No matching active staff found for payrollRows");
    const grossBase = parseNumber(payload.defaultGrossAmount ?? payload.default_gross_amount, 30000);
    const trx = db.transaction(() => {
      const run = {
        id: makeId("payrun"),
        tenant_id: access.tenantId,
        branch_id: branchId,
        period_start: periodStart,
        period_end: periodEnd,
        status: "draft",
        gross_amount: 0,
        deductions_amount: 0,
        net_amount: 0,
        created_by: access.userId || ""
      };
      db.prepare(`INSERT INTO staff_payroll_runs (id, tenant_id, branch_id, period_start, period_end, status, gross_amount, deductions_amount, net_amount, created_by)
        VALUES (@id, @tenant_id, @branch_id, @period_start, @period_end, @status, @gross_amount, @deductions_amount, @net_amount, @created_by)`).run(run);
      let gross = 0;
      let deductions = 0;
      let net = 0;
      for (const staff of staffRows) {
        const generatedRow = payloadRowsByStaff.get(String(staff.id));
        const salaryRow = db.prepare(`SELECT new_ctc FROM salary_revision_history
          WHERE tenant_id = ? AND staff_id = ? AND approval_status = 'approved' AND effective_date <= ?
          ORDER BY effective_date DESC, approved_at DESC LIMIT 1`).get(access.tenantId, staff.id, periodEnd);
        const salaryProfile = staff.employeeDetails?.attendanceSalary || {};
        const profileGross = parseNumber(salaryProfile.basicSalary, 0);
        const effectiveGross = salaryRow?.new_ctc ? Number(salaryRow.new_ctc) / 12 : (profileGross || grossBase);
        const itemGross = generatedRow ? parseNumber(generatedRow.grossEarning ?? generatedRow.gross_amount, 0) : parseNumber(payload.grossAmountByStaff?.[staff.id], effectiveGross);
        const pf = salaryProfile.pfApplicable === false ? 0 : Math.min(itemGross * 0.12, 1800);
        const tds = salaryProfile.tdsApplicable === false ? 0 : (itemGross > 50000 ? itemGross * 0.05 : 0);
        const pt = salaryProfile.ptApplicable === false ? 0 : (itemGross > 15000 ? 200 : 0);
        const esic = salaryProfile.esicApplicable === false ? 0 : (itemGross <= 21000 ? itemGross * 0.0075 : 0);
        const statutoryDeduction = pf + tds + pt + esic;
        const previewDeduction = generatedRow
          ? parseNumber(generatedRow.deductions, 0) + parseNumber(generatedRow.advanceDeducted, 0)
          : 0;
        const deduction = generatedRow ? previewDeduction + statutoryDeduction : statutoryDeduction;
        const netAmount = generatedRow ? Math.max(0, parseNumber(generatedRow.netSalary ?? generatedRow.net_amount, itemGross - deduction) - statutoryDeduction) : itemGross - deduction;
        const overtimeAmount = generatedRow ? parseNumber(generatedRow.otAmount, 0) : 0;
        const bonusAmount = generatedRow
          ? parseNumber(generatedRow.totalCommission, 0) + parseNumber(generatedRow.weekOffPayout, 0) + parseNumber(generatedRow.tips, 0) + parseNumber(generatedRow.allowances, 0)
          : 0;
        gross += itemGross;
        deductions += deduction;
        net += netAmount;
        db.prepare(`INSERT INTO staff_payroll_items (id, tenant_id, payroll_run_id, branch_id, staff_id, gross_amount, deduction_amount, net_amount, statutory_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          makeId("payitem"), access.tenantId, run.id, staff.branchId, staff.id, itemGross, deduction, netAmount,
          json({
            pf,
            esic,
            tds,
            professionalTax: pt,
            overtimeAmount,
            bonusAmount,
            generatedFromPreview: Boolean(generatedRow),
            preview: generatedRow || null,
            complianceMode: "draft-ready",
            salarySource: salaryRow?.new_ctc ? "approved_salary_revision" : (profileGross ? "staff_employee_details" : "default_gross_amount"),
            profilePaymentMode: salaryProfile.paymentMode || "",
            profileBankName: salaryProfile.bankName || "",
            profileStatutoryIds: {
              pfNo: salaryProfile.pfNo || "",
              ptNo: salaryProfile.ptNo || "",
              esicNo: salaryProfile.esicNo || "",
              panNo: salaryProfile.panNo || "",
              aadhaarNo: salaryProfile.aadhaarNo || ""
            }
          })
        );
      }
      db.prepare(`UPDATE staff_payroll_runs SET gross_amount = ?, deductions_amount = ?, net_amount = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
        .run(gross, deductions, net, now(), run.id, access.tenantId);
      this.writeAudit("staff.payroll_generated", "staff_payroll_runs", run.id, access, { after: { ...run, gross, deductions, net }, branchId });
      return rowToCamel(db.prepare("SELECT * FROM staff_payroll_runs WHERE id = ? AND tenant_id = ?").get(run.id, access.tenantId));
    });
    const run = trx();
    this.emit("staff:payroll_generated", access, branchId, run.id);
    const penaltyNotifications = this.queuePayrollPenaltyNotifications(run, staffRows, payloadRowsByStaff, access);
    return { ...run, items: this.payrollItems(run.id, access), penaltyNotifications };
  }

  queuePayrollPenaltyNotifications(run = {}, staffRows = [], payloadRowsByStaff = new Map(), access = {}) {
    const results = [];
    for (const staff of staffRows) {
      const generatedRow = payloadRowsByStaff.get(String(staff.id));
      const breakdown = Array.isArray(generatedRow?.rulePenaltyBreakdown) ? generatedRow.rulePenaltyBreakdown : [];
      const amount = parseNumber(generatedRow?.rulePenalty, 0);
      if (!amount || !breakdown.length) continue;
      const branchId = staff.branchId || run.branchId || access.branchId || "";
      const preference = db.prepare("SELECT * FROM staff_notification_preferences WHERE tenant_id = ? AND staff_id = ?").get(access.tenantId, staff.id) || {};
      const phone = Number(preference.whatsapp_opt_in ?? 1) === 1 ? firstStaffPhone(staff) : "";
      const copy = penaltyNotificationCopy(run, staff, generatedRow);
      const metadata = {
        payrollRunId: run.id,
        staffId: staff.id,
        periodStart: run.periodStart || generatedRow.periodStart || "",
        periodEnd: run.periodEnd || generatedRow.periodEnd || "",
        rulePenalty: amount,
        rulePenaltyPaise: Math.round(amount * 100),
        breakdown,
        source: "salary-generate"
      };
      if (!phone) {
        this.writeAudit("staff.penalty_notification_skipped", "staff_payroll_runs", run.id, access, {
          branchId,
          details: { staffId: staff.id, reason: Number(preference.whatsapp_opt_in ?? 1) !== 1 ? "whatsapp_opt_out" : "missing_staff_phone", ...metadata }
        });
        results.push({ staffId: staff.id, status: "skipped", reason: "missing_or_opted_out_phone" });
        continue;
      }
      try {
        const job = jobQueueService.enqueue({
          tenantId: access.tenantId,
          jobType: "whatsapp_send",
          payload: {
            phone,
            body: copy.body,
            branchId,
            staffId: staff.id,
            source: "staff-penalty",
            eventType: "staff_penalty_applied",
            refId: run.id,
            variables: {
              client_name: staff.fullName || staff.firstName || generatedRow.staffName || "Staff",
              staff_name: staff.fullName || staff.firstName || generatedRow.staffName || "Staff",
              penalty_amount: formatRupees(copy.amount),
              period_start: metadata.periodStart,
              period_end: metadata.periodEnd,
              rule_breaks: breakdown.map((item) => item.ruleName || "Penalty rule").join(", ")
            }
          },
          priority: 2
        });
        const row = {
          id: makeId("snotif"),
          tenant_id: access.tenantId,
          branch_id: branchId,
          staff_id: staff.id,
          notification_type: "staff_penalty_applied",
          template_id: "",
          channel: "whatsapp",
          language: preference.language || "en-IN",
          message_preview: copy.body,
          sensitive: 0,
          requires_approval: 0,
          status: "queued",
          quiet_hours_deferred: 0,
          scheduled_at: now(),
          metadata_json: json({ ...metadata, jobId: job.id, channel: "whatsapp" }),
          created_by: access.userId || ""
        };
        db.prepare(`INSERT INTO staff_notification_queue
          (id, tenant_id, branch_id, staff_id, notification_type, template_id, channel, language, message_preview, sensitive, requires_approval, status, quiet_hours_deferred, scheduled_at, metadata_json, created_by)
          VALUES (@id, @tenant_id, @branch_id, @staff_id, @notification_type, @template_id, @channel, @language, @message_preview, @sensitive, @requires_approval, @status, @quiet_hours_deferred, @scheduled_at, @metadata_json, @created_by)`).run(row);
        this.writeAudit("staff.penalty_notification_queued", "staff_notification_queue", row.id, access, { after: row, branchId });
        results.push({ staffId: staff.id, status: "queued", notificationId: row.id, jobId: job.id });
      } catch (error) {
        this.writeAudit("staff.penalty_notification_failed", "staff_payroll_runs", run.id, access, {
          branchId,
          details: { staffId: staff.id, error: String(error?.message || error).slice(0, 250), ...metadata }
        });
        results.push({ staffId: staff.id, status: "failed", error: String(error?.message || error) });
      }
    }
    return results;
  }

  listPayroll(query = {}, access) {
    access = normalizeAccess(access);
    requireRole(access, payrollRoles, "Payroll access is restricted");
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      limit: Math.min(parseNumber(query.limit, 50), 200)
    };
    const filters = [branchScopedWhere(access, params)];
    if (params.status) filters.push("status = @status");
    return db.prepare(`SELECT * FROM staff_payroll_runs WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT @limit`).all(params).map(rowToCamel);
  }

  payrollItems(runId, access) {
    return db.prepare("SELECT * FROM staff_payroll_items WHERE tenant_id = ? AND payroll_run_id = ? ORDER BY staff_id")
      .all(access.tenantId, runId).map(rowToCamel);
  }

  approvePayroll(id, access) {
    return this.transitionPayroll(id, "approved", "staff:payroll_approved", access);
  }

  markPayrollPaid(id, access) {
    return this.transitionPayroll(id, "paid", "staff:payroll_paid", access);
  }

  transitionPayroll(id, status, eventType, access) {
    access = normalizeAccess(access);
    requireRole(access, payrollRoles, "Payroll access is restricted");
    const run = db.prepare("SELECT * FROM staff_payroll_runs WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!run) throw notFound("Payroll run not found");
    if (run.branch_id) assertBranch(access, run.branch_id);
    const stamp = now();
    db.transaction(() => {
      db.prepare(`UPDATE staff_payroll_runs SET status = ?, approved_by = COALESCE(NULLIF(approved_by, ''), ?), approved_at = COALESCE(NULLIF(approved_at, ''), ?),
        paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END, version = version + 1, updated_at = ?
        WHERE id = ? AND tenant_id = ?`).run(status, access.userId || "", stamp, status, stamp, stamp, id, access.tenantId);
      db.prepare("UPDATE staff_payroll_items SET status = ?, version = version + 1, updated_at = ? WHERE payroll_run_id = ? AND tenant_id = ?")
        .run(status, stamp, id, access.tenantId);
      this.writeAudit(`staff.payroll_${status}`, "staff_payroll_runs", id, access, { before: run, after: { status }, branchId: run.branch_id });
    })();
    this.emit(eventType, access, run.branch_id, id);
    return rowToCamel(db.prepare("SELECT * FROM staff_payroll_runs WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
  }

  calculateCommission(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const branchId = pickBranch(payload, access);
    if (branchId) assertBranch(access, branchId);
    const staffId = payload.staffId || payload.staff_id;
    if (!staffId) throw badRequest("staffId is required");
    const staff = this.getStaff(staffId, access);
    const baseAmount = parseNumber(payload.baseAmount ?? payload.base_amount, 0);
    const rate = parseNumber(payload.rate, 10);
    const row = {
      id: makeId("comm"),
      tenant_id: access.tenantId,
      branch_id: branchId || staff.branchId,
      staff_id: staffId,
      period_start: payload.periodStart || payload.period_start || businessDate(),
      period_end: payload.periodEnd || payload.period_end || businessDate(),
      commission_type: payload.commissionType || payload.commission_type || "service",
      base_amount: baseAmount,
      commission_amount: baseAmount * (rate / 100),
      status: "calculated"
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_commissions (id, tenant_id, branch_id, staff_id, period_start, period_end, commission_type, base_amount, commission_amount, status)
        VALUES (@id, @tenant_id, @branch_id, @staff_id, @period_start, @period_end, @commission_type, @base_amount, @commission_amount, @status)`).run(row);
      this.writeAudit("staff.commission_calculated", "staff_commissions", row.id, access, { after: row, branchId: row.branch_id });
    })();
    this.emit("staff:commission_calculated", access, row.branch_id, row.id);
    return rowToCamel(db.prepare("SELECT * FROM staff_commissions WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  listCommissions(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      status: query.status || "",
      limit: Math.min(parseNumber(query.limit, 100), 500)
    };
    const filters = [branchScopedWhere(access, params)];
    if (params.status) filters.push("status = @status");
    return db.prepare(`SELECT * FROM staff_commissions WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT @limit`).all(params).map(rowToCamel);
  }

  approveCommission(id, access) {
    access = normalizeAccess(access);
    requireRole(access, commissionRoles, "Commission approvals are restricted");
    const row = db.prepare("SELECT * FROM staff_commissions WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Commission not found");
    if (row.branch_id) assertBranch(access, row.branch_id);
    db.transaction(() => {
      db.prepare("UPDATE staff_commissions SET status = 'approved', approved_by = ?, approved_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(access.userId || "", now(), now(), id, access.tenantId);
      this.writeAudit("staff.commission_approved", "staff_commissions", id, access, { before: row, branchId: row.branch_id });
    })();
    this.emit("staff:commission_approved", access, row.branch_id, id);
    return rowToCamel(db.prepare("SELECT * FROM staff_commissions WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
  }

  listTips(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      from: query.from || query.dateFrom || "",
      to: query.to || query.dateTo || "",
      limit: Math.min(parseNumber(query.limit, 100), 500)
    };
    const filters = [branchScopedWhere(access, params)];
    if (params.from) filters.push("business_date >= @from");
    if (params.to) filters.push("business_date <= @to");
    return db.prepare(`SELECT * FROM staff_tips WHERE ${filters.join(" AND ")} ORDER BY business_date DESC LIMIT @limit`).all(params).map(rowToCamel);
  }

  tipsReport(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || ""
    };
    const where = branchScopedWhere(access, params);
    const rows = db.prepare(`SELECT staff_id, SUM(amount) AS total_amount, COUNT(*) AS tips_count FROM staff_tips WHERE ${where} GROUP BY staff_id ORDER BY total_amount DESC`).all(params);
    return { rows: rows.map(rowToCamel), totals: { amount: rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0), count: rows.reduce((sum, row) => sum + Number(row.tips_count || 0), 0) } };
  }

  performance(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      from: query.from || query.dateFrom || "",
      to: query.to || query.dateTo || "",
      limit: Math.min(parseNumber(query.limit, 100), 500)
    };
    const filters = [branchScopedWhere(access, params)];
    if (params.from) filters.push("business_date >= @from");
    if (params.to) filters.push("business_date <= @to");
    const rows = db.prepare(`SELECT * FROM staff_performance_daily WHERE ${filters.join(" AND ")} ORDER BY business_date DESC LIMIT @limit`).all(params).map(rowToCamel);
    return { rows, summary: this.performanceSummary(rows) };
  }

  performanceByStaff(staffId, query = {}, access) {
    access = normalizeAccess(access);
    this.getStaff(staffId, access);
    const rows = db.prepare(`SELECT * FROM staff_performance_daily WHERE tenant_id = ? AND staff_id = ? ORDER BY business_date DESC LIMIT ?`)
      .all(access.tenantId, staffId, Math.min(parseNumber(query.limit, 30), 365)).map(rowToCamel);
    return { staffId, rows, summary: this.performanceSummary(rows) };
  }

  leaderboard(query = {}, access) {
    const rows = this.performance(query, access).rows;
    const grouped = new Map();
    for (const row of rows) {
      const current = grouped.get(row.staffId) || { staffId: row.staffId, revenue: 0, score: 0, days: 0, rating: 0 };
      current.revenue += Number(row.revenueGenerated || 0);
      current.score += Number(row.productivityScore || 0);
      current.rating += Number(row.avgRating || 0);
      current.days += 1;
      grouped.set(row.staffId, current);
    }
    return [...grouped.values()].map((row) => ({ ...row, avgScore: row.days ? row.score / row.days : 0, avgRating: row.days ? row.rating / row.days : 0 }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }

  performanceSummary(rows = []) {
    return {
      days: rows.length,
      revenue: rows.reduce((sum, row) => sum + Number(row.revenueGenerated || 0), 0),
      avgUtilization: rows.length ? rows.reduce((sum, row) => sum + Number(row.utilizationPct || 0), 0) / rows.length : 0,
      avgScore: rows.length ? rows.reduce((sum, row) => sum + Number(row.productivityScore || 0), 0) / rows.length : 0
    };
  }

  burnoutRisk(query = {}, access) {
    access = normalizeAccess(access);
    const staff = query.staffId ? [this.getStaff(query.staffId, access)] : this.listStaff({ branchId: query.branchId, status: "active", limit: 200 }, access);
    return staff.map((item) => this.scoreBurnout(item.id, access));
  }

  churnRisk(query = {}, access) {
    return this.burnoutRisk(query, access).map((score) => ({
      ...score,
      score: Math.min(100, Math.round(score.score * 0.7 + (score.reasons.includes("low review score") ? 20 : 0))),
      level: score.score >= 70 ? "high" : score.score >= 40 ? "medium" : "low"
    }));
  }

  bestStaff(payload = {}, access) {
    access = normalizeAccess(access);
    const branchId = pickBranch(payload, access);
    if (branchId) assertBranch(access, branchId);
    const candidates = this.listStaff({ branchId, status: "active", limit: 200 }, access);
    return candidates.map((staff) => {
      const availability = this.availability({ staffId: staff.id, branchId, date: payload.date || businessDate(), serviceId: payload.serviceId || "" }, access);
      const perf = this.performanceByStaff(staff.id, { limit: 30 }, access).summary;
      const score = Math.round((availability.available ? 35 : 0) + Math.min(30, perf.avgScore / 3) + Math.min(20, perf.avgUtilization / 5) + (staff.status === "active" ? 15 : 0));
      return {
        staffId: staff.id,
        staffName: staff.fullName,
        score,
        level: score >= 75 ? "excellent" : score >= 50 ? "good" : "backup",
        reasons: availability.reasons.concat([`avg productivity ${Math.round(perf.avgScore)}`]),
        recommendedActions: score >= 75 ? ["Assign as primary recommendation"] : ["Check manager approval before assignment"]
      };
    }).sort((a, b) => b.score - a.score);
  }

  replacementSuggestion(payload = {}, access) {
    const recommendations = this.bestStaff(payload, access).filter((item) => item.staffId !== payload.unavailableStaffId);
    return {
      unavailableStaffId: payload.unavailableStaffId || "",
      recommendations: recommendations.slice(0, 5),
      decisionPolicy: "rule_based_manager_approval_required"
    };
  }

  scoreBurnout(staffId, access) {
    const attendance = db.prepare(`SELECT * FROM staff_attendance_logs WHERE tenant_id = ? AND staff_id = ? ORDER BY business_date DESC LIMIT 30`)
      .all(access.tenantId, staffId);
    const perf = db.prepare(`SELECT * FROM staff_performance_daily WHERE tenant_id = ? AND staff_id = ? ORDER BY business_date DESC LIMIT 30`)
      .all(access.tenantId, staffId);
    const overtime = attendance.reduce((sum, row) => sum + Number(row.overtime_minutes || 0), 0);
    const avgUtilization = perf.length ? perf.reduce((sum, row) => sum + Number(row.utilization_pct || 0), 0) / perf.length : 0;
    const avgRating = perf.length ? perf.reduce((sum, row) => sum + Number(row.avg_rating || 0), 0) / perf.length : 5;
    const reasons = [];
    let score = 0;
    if (overtime > 600) { score += 30; reasons.push("high overtime"); }
    if (avgUtilization > 85) { score += 25; reasons.push("high utilization"); }
    if (attendance.length >= 10) { score += 15; reasons.push("long consecutive attendance pattern"); }
    if (avgRating < 3.5) { score += 20; reasons.push("low review score"); }
    score = Math.min(100, score);
    return {
      staffId,
      score,
      level: score >= 70 ? "high" : score >= 40 ? "medium" : "low",
      reasons: reasons.length ? reasons : ["normal operating pattern"],
      recommendedActions: score >= 70 ? ["Review roster load", "Offer recovery break", "Assign backup for high-stress services"] : ["Continue weekly monitoring"]
    };
  }

  availability(payload = {}, access) {
    access = normalizeAccess(access);
    const staffId = payload.staffId || payload.staff_id;
    if (!staffId) throw badRequest("staffId is required");
    const staff = this.getStaff(staffId, access);
    const branchId = pickBranch(payload, access) || staff.branchId;
    assertBranch(access, branchId);
    const date = payload.date || payload.businessDate || businessDate();
    const leave = db.prepare(`SELECT id FROM staff_leaves WHERE tenant_id = ? AND staff_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?`)
      .get(access.tenantId, staffId, date, date);
    const schedule = db.prepare(`SELECT * FROM staff_schedules WHERE tenant_id = ? AND staff_id = ? AND branch_id = ? AND schedule_date = ? AND status != 'cancelled'`)
      .get(access.tenantId, staffId, branchId, date);
    const eligibility = payload.serviceId
      ? db.prepare(`SELECT allowed FROM staff_service_eligibility WHERE tenant_id = ? AND staff_id = ? AND service_id = ?`).get(access.tenantId, staffId, payload.serviceId)
      : null;
    const reasons = [];
    if (!schedule) reasons.push("no rostered shift");
    if (leave) reasons.push("approved leave");
    if (eligibility && Number(eligibility.allowed) !== 1) reasons.push("service not eligible");
    const perf = this.performanceByStaff(staffId, { limit: 7 }, access).summary;
    return {
      available: reasons.length === 0,
      utilization: perf.avgUtilization,
      nextFreeSlot: schedule ? `${date}T${schedule.start_time}:00` : "",
      reasons: reasons.length ? reasons : ["rostered and eligible"]
    };
  }

  mobileDashboard(query = {}, access) {
    access = normalizeAccess(access);
    const staffId = query.staffId || access.userId;
    const staff = this.getStaff(staffId, access);
    return {
      staff,
      today: this.mobileToday({ staffId }, access),
      payroll: payrollRoles.has(access.role) ? this.listPayroll({ branchId: staff.branchId, limit: 5 }, access) : [],
      targets: db.prepare("SELECT * FROM staff_targets WHERE tenant_id = ? AND staff_id = ? ORDER BY created_at DESC LIMIT 10").all(access.tenantId, staffId).map(rowToCamel)
    };
  }

  mobileToday(query = {}, access) {
    access = normalizeAccess(access);
    const staffId = query.staffId || access.userId;
    const staff = this.getStaff(staffId, access);
    const date = query.date || businessDate();
    return {
      date,
      schedules: this.listSchedules({ staffId, branchId: staff.branchId, from: date, to: date }, access),
      attendance: this.listAttendance({ staffId, branchId: staff.branchId, from: date, to: date }, access),
      tasks: this.listTasks({ staffId, branchId: staff.branchId, status: "open" }, access)
    };
  }

  startService(payload = {}, access) {
    return { started: true, staffId: payload.staffId || access.userId, appointmentId: payload.appointmentId || "", startedAt: now() };
  }

  completeService(payload = {}, access) {
    return { completed: true, staffId: payload.staffId || access.userId, appointmentId: payload.appointmentId || "", completedAt: now(), notes: payload.notes || "" };
  }

  mobilePayroll(query = {}, access) {
    access = normalizeAccess(access);
    const staffId = query.staffId || access.userId;
    return db.prepare("SELECT * FROM staff_payroll_items WHERE tenant_id = ? AND staff_id = ? ORDER BY created_at DESC LIMIT 12")
      .all(access.tenantId, staffId).map(rowToCamel);
  }

  mobileTargets(query = {}, access) {
    access = normalizeAccess(access);
    const staffId = query.staffId || access.userId;
    return db.prepare("SELECT * FROM staff_targets WHERE tenant_id = ? AND staff_id = ? ORDER BY created_at DESC LIMIT 12")
      .all(access.tenantId, staffId).map(rowToCamel);
  }

  listTasks(query = {}, access) {
    access = normalizeAccess(access);
    const params = {
      tenant_id: access.tenantId,
      branch_id: query.branchId || query.branch_id || access.requestedBranchId || "",
      staff_id: query.staffId || query.staff_id || "",
      status: query.status || "",
      limit: Math.min(parseNumber(query.limit, 100), 500)
    };
    const filters = [branchScopedWhere(access, params)];
    if (params.staff_id) filters.push("staff_id = @staff_id");
    if (params.status) filters.push("status = @status");
    return db.prepare(`SELECT * FROM staff_tasks WHERE ${filters.join(" AND ")} ORDER BY due_at IS NULL, due_at ASC, created_at DESC LIMIT @limit`).all(params).map(rowToCamel);
  }

  createTask(payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const branchId = pickBranch(payload, access);
    if (branchId) assertBranch(access, branchId);
    const row = {
      id: makeId("task"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      staff_id: payload.staffId || payload.staff_id || "",
      title: payload.title || "",
      description: payload.description || "",
      task_type: payload.taskType || payload.task_type || "general",
      priority: payload.priority || "medium",
      due_at: payload.dueAt || payload.due_at || "",
      status: payload.status || "open",
      assigned_by: access.userId || ""
    };
    if (!row.title) throw badRequest("title is required");
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_tasks (id, tenant_id, branch_id, staff_id, title, description, task_type, priority, due_at, status, assigned_by)
        VALUES (@id, @tenant_id, @branch_id, @staff_id, @title, @description, @task_type, @priority, @due_at, @status, @assigned_by)`).run(row);
      this.writeAudit("staff.task_assigned", "staff_tasks", row.id, access, { after: row, branchId });
    })();
    this.emit("staff:task_assigned", access, branchId, row.id);
    return rowToCamel(db.prepare("SELECT * FROM staff_tasks WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  updateTask(id, payload = {}, access) {
    access = normalizeAccess(access);
    const existing = db.prepare("SELECT * FROM staff_tasks WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!existing) throw notFound("Task not found");
    if (existing.branch_id) assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version)) throw conflict("Task was updated by another request");
    const next = {
      id,
      tenant_id: access.tenantId,
      title: payload.title ?? existing.title,
      description: payload.description ?? existing.description,
      priority: payload.priority ?? existing.priority,
      due_at: payload.dueAt ?? payload.due_at ?? existing.due_at,
      status: payload.status ?? existing.status,
      completed_at: payload.status === "completed" ? now() : existing.completed_at,
      version: Number(existing.version || 1) + 1,
      updated_at: now()
    };
    db.prepare(`UPDATE staff_tasks SET title = @title, description = @description, priority = @priority, due_at = @due_at,
      status = @status, completed_at = @completed_at, version = @version, updated_at = @updated_at
      WHERE id = @id AND tenant_id = @tenant_id`).run(next);
    if (next.status === "completed") this.emit("staff:task_completed", access, existing.branch_id, id);
    return rowToCamel(db.prepare("SELECT * FROM staff_tasks WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
  }

  addTaskComment(id, payload = {}, access) {
    access = normalizeAccess(access);
    const task = db.prepare("SELECT * FROM staff_tasks WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!task) throw notFound("Task not found");
    if (task.branch_id) assertBranch(access, task.branch_id);
    const row = {
      id: makeId("tcmt"),
      tenant_id: access.tenantId,
      task_id: id,
      actor_user_id: access.userId || "",
      comment_text: payload.comment || payload.commentText || payload.comment_text || ""
    };
    if (!row.comment_text) throw badRequest("comment is required");
    db.prepare(`INSERT INTO task_comments (id, tenant_id, task_id, actor_user_id, comment_text)
      VALUES (@id, @tenant_id, @task_id, @actor_user_id, @comment_text)`).run(row);
    return rowToCamel(db.prepare("SELECT * FROM task_comments WHERE id = ? AND tenant_id = ?").get(row.id, access.tenantId));
  }

  auditTrail(query = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const rows = db.prepare(`SELECT * FROM staff_audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(access.tenantId, Math.min(parseNumber(query.limit, 100), 500));
    return rows.map(rowToCamel);
  }

  report(type, query = {}, access) {
    access = normalizeAccess(access);
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || "";
    if (branchId) assertBranch(access, branchId);
    const params = { tenant_id: access.tenantId, branch_id: branchId };
    const where = branchScopedWhere(access, params);
    if (type === "attendance") {
      return { type, rows: db.prepare(`SELECT staff_id, COUNT(*) AS days, SUM(overtime_minutes) AS overtime_minutes FROM staff_attendance_logs WHERE ${where} GROUP BY staff_id`).all(params).map(rowToCamel) };
    }
    if (type === "payroll") {
      requireRole(access, payrollRoles, "Payroll reports are restricted");
      return { type, rows: db.prepare(`SELECT status, COUNT(*) AS runs, SUM(net_amount) AS net_amount FROM staff_payroll_runs WHERE ${where} GROUP BY status`).all(params).map(rowToCamel) };
    }
    if (type === "commission") {
      return { type, rows: db.prepare(`SELECT staff_id, SUM(commission_amount) AS commission_amount FROM staff_commissions WHERE ${where} GROUP BY staff_id`).all(params).map(rowToCamel) };
    }
    if (type === "tips") return { type, ...this.tipsReport(query, access) };
    if (type === "training") {
      return { type, rows: db.prepare("SELECT staff_id, status, COUNT(*) AS count FROM staff_training WHERE tenant_id = ? GROUP BY staff_id, status").all(access.tenantId).map(rowToCamel) };
    }
    if (["revenue", "utilization", "productivity"].includes(type)) return { type, ...this.performance(query, access) };
    return { type, rows: [] };
  }

  resolveMobileStaff(payload = {}, access) {
    const staffId = payload.staffId || payload.staff_id || access.staffId || access.userId;
    if (!staffId) throw badRequest("staffId is required");
    const staff = this.getStaff(staffId, access);
    if (access.role === "staff" && access.userId !== staffId) throw forbidden("Staff mobile endpoints are limited to the current staff identity");
    return staff;
  }

  emit(type, access, branchId, id) {
    const payload = {
      tenantId: access.tenantId,
      branchId: branchId || "",
      id,
      type,
      timestamp: now(),
      actorUserId: access.userId || ""
    };
    try {
      realtimeService.broadcast(type, payload, {
        tenantId: access.tenantId,
        branchId: branchId || "",
        channel: branchId ? `branch:${branchId}` : `tenant:${access.tenantId}`
      });
    } catch {
      // Realtime persistence should not roll back the already committed domain mutation.
    }
  }

  writeAudit(action, entityType, entityId, access, { before = null, after = null, details = {}, branchId = "" } = {}) {
    const row = {
      id: makeId("saudit"),
      tenant_id: access.tenantId,
      branch_id: branchId || access.branchId || "",
      actor_user_id: access.userId || "",
      actor_role: access.role || "",
      action,
      entity_type: entityType,
      entity_id: entityId,
      before_json: before ? json(before) : "",
      after_json: after ? json(after) : "",
      details_json: json(details)
    };
    db.prepare(`INSERT INTO staff_audit_logs (id, tenant_id, branch_id, actor_user_id, actor_role, action, entity_type, entity_id, before_json, after_json, details_json)
      VALUES (@id, @tenant_id, @branch_id, @actor_user_id, @actor_role, @action, @entity_type, @entity_id, @before_json, @after_json, @details_json)`).run(row);
    setTimeout(() => {
      try {
        securityService.audit({ action, targetType: entityType, targetId: entityId, details: { branchId, ...details }, severity: "info" }, access);
      } catch {
        // Staff OS audit_log remains the source of truth if global audit is unavailable.
      }
    }, 0);
    return row;
  }
}

export const staffOsService = new StaffOsService();
