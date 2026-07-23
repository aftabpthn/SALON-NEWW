import { db } from "../db.js";
import { forbidden } from "../utils/app-error.js";

const privilegedRoles = new Set(["owner", "admin", "superadmin", "manager", "accountant"]);

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=@name").get({ name }));
}

export function assertAttendanceVerification(payload = {}, access = {}, action) {
  if (access.attendanceVerificationApproved || privilegedRoles.has(String(access.role || "").toLowerCase())) return;
  if (!tableExists("attendanceLocationPolicies")) return;
  const branchId = String(access.branchId || access.requestedBranchId || payload.branchId || payload.branch_id || "");
  if (!access.tenantId || !branchId) return;
  const policy = db.prepare(`SELECT status, clockInEnforced, clockOutEnforced FROM attendanceLocationPolicies
    WHERE tenantId=@tenantId AND branchId=@branchId LIMIT 1`).get({ tenantId: access.tenantId, branchId });
  const enforced = policy?.status === "active" && (action === "clock_in" ? Number(policy.clockInEnforced) === 1 : Number(policy.clockOutEnforced) === 1);
  if (enforced) throw forbidden("Verified online biometric attendance is required for this branch");
}
