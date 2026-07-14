import { db } from "../db.js";
import { badRequest, forbidden } from "../utils/app-error.js";
import { staffOsService } from "./staff-os.service.js";
import { tenantService } from "./tenant.service.js";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(value) {
  if (!isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateStaffLeaveRequest(payload = {}, access = {}) {
  const tenantId = String(access.tenantId || "").trim();
  if (!tenantId) throw forbidden("Tenant context is required");

  const linkedStaffId = String(access.staffId || "").trim();
  const requestedStaffId = String(payload.staffId || payload.staff_id || "").trim();
  if (linkedStaffId && requestedStaffId && linkedStaffId !== requestedStaffId) {
    throw forbidden("Staff app can access only the logged-in staff profile");
  }
  const staffId = linkedStaffId || requestedStaffId;
  if (!staffId) throw badRequest("staffId is required");

  const branchId = String(payload.branchId || payload.branch_id || access.requestedBranchId || access.branchId || "").trim();
  if (branchId) {
    tenantService.assertBranchAccess(access, branchId);
    const branch = db.prepare("SELECT id FROM branches WHERE tenantId = @tenantId AND id = @branchId").get({ tenantId, branchId });
    if (!branch) throw badRequest("branchId is invalid");
  }

  let leaveType = String(payload.leaveType || payload.leave_type || "casual").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,49}$/.test(leaveType)) throw badRequest("leaveType is invalid");

  const startDate = String(payload.startDate || payload.start_date || "").trim();
  const endDate = String(payload.endDate || payload.end_date || startDate).trim();
  if (startDate && !validIsoDate(startDate)) throw badRequest("startDate must be a valid YYYY-MM-DD date");
  if (endDate && !validIsoDate(endDate)) throw badRequest("endDate must be a valid YYYY-MM-DD date");
  if (startDate && endDate && endDate < startDate) throw badRequest("endDate cannot be before startDate");

  const reason = String(payload.reason || "").trim();
  if (reason.length > 1000) throw badRequest("reason must be 1000 characters or fewer");

  if (branchId) {
    const configuredTypes = db.prepare(`SELECT code FROM staff_leave_type_master
      WHERE tenant_id = @tenantId AND status = 'active' AND (branch_id = @branchId OR branch_id = '')`).all({ tenantId, branchId });
    if (configuredTypes.length) {
      const configured = configuredTypes.find((row) => String(row.code).toLowerCase() === leaveType.toLowerCase());
      if (!configured) throw badRequest("leaveType is not configured for this branch");
      leaveType = configured.code;
    }
  }

  return {
    payload: { ...payload, branchId, staffId, leaveType, startDate, endDate, reason },
    tenantId,
    branchId,
    staffId,
    leaveType,
    startDate,
    endDate
  };
}

function pendingDuplicate({ tenantId, branchId, staffId, leaveType, startDate, endDate }) {
  if (!branchId || !startDate || !endDate) return null;
  // ponytail: app-level duplicate guard is enough for one SQLite writer; add a DB unique key/idempotency key before multi-process writes.
  return db.prepare(`SELECT id,
      tenant_id AS tenantId,
      branch_id AS branchId,
      staff_id AS staffId,
      leave_type AS leaveType,
      start_date AS startDate,
      end_date AS endDate,
      reason,
      status,
      approved_by AS approvedBy,
      approved_at AS approvedAt,
      rejection_reason AS rejectionReason,
      version,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM staff_leaves
    WHERE tenant_id = @tenantId
      AND branch_id = @branchId
      AND staff_id = @staffId
      AND leave_type = @leaveType
      AND start_date = @startDate
      AND end_date = @endDate
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1`).get({ tenantId, branchId, staffId, leaveType, startDate, endDate });
}

export const staffLeaveRequestService = {
  requestLeave(payload = {}, access = {}) {
    const validated = validateStaffLeaveRequest(payload, access);
    const existing = pendingDuplicate(validated);
    if (existing) return { ...existing, duplicate: true };
    return staffOsService.requestLeave(validated.payload, access);
  }
};
