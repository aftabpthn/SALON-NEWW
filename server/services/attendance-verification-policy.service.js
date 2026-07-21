import { db } from "../db.js";
import { forbidden } from "../utils/app-error.js";

const correctionRoles = new Set(["owner", "admin", "superAdmin"]);

export function assertStaffAttendanceVerification(payload = {}, access = {}, action) {
  if (access.attendanceVerificationApproved) return;
  if (access.attendanceManagedCorrection === true && correctionRoles.has(access.role)) return;
  const linked = !access.staffId && access.tenantId && access.userId
    ? db.prepare("SELECT staffId FROM tenant_users WHERE tenantId=@tenantId AND id=@userId").get({ tenantId: access.tenantId, userId: access.userId })
    : null;
  const targetStaffId = String(payload.staffId || payload.staff_id || access.staffId || linked?.staffId || "").trim();
  if (!targetStaffId) return;
  const staff = db.prepare(`SELECT branch_id AS branchId FROM staff_master
    WHERE tenant_id = @tenantId AND id = @staffId`).get({ tenantId: access.tenantId, staffId: targetStaffId })
    || db.prepare(`SELECT branchId FROM staff WHERE tenantId = @tenantId AND id = @staffId`)
      .get({ tenantId: access.tenantId, staffId: targetStaffId });
  const branchId = String(staff?.branchId || payload.branchId || payload.branch_id || access.requestedBranchId || access.branchId || "").trim();
  if (!access.tenantId || !branchId) return;
  const policy = db.prepare(`SELECT status, enforceClockIn, enforceClockOut
    FROM attendanceVerificationPolicies WHERE tenantId = @tenantId AND branchId = @branchId`).get({
    tenantId: access.tenantId,
    branchId
  });
  const enforced = policy?.status === "active" && Number(action === "clock_in" ? policy.enforceClockIn : policy.enforceClockOut) === 1;
  if (enforced) {
    const error = forbidden("Verified mobile attendance is required for this branch");
    error.details = { reason: "verification_required", action };
    throw error;
  }
}
