import { db } from "../db.js";
import { staffAppRolePolicy, saveStaffAppRolePolicy } from "../services/staff-app-role-policy.service.js";

const TENANT_ID = "tenant_aura";
const ROLE = "staff";

const policy = staffAppRolePolicy(TENANT_ID, "", ROLE);
console.log("Current policy:", JSON.stringify(policy, null, 2));

if (policy.mode === "override" || policy.effectiveKeys.length < 10) {
  saveStaffAppRolePolicy({
    tenantId: TENANT_ID,
    branchId: "",
    role: ROLE,
    mode: "inherited",
    allowKeys: [],
    denyKeys: [],
    status: "active",
    updatedBy: "migration"
  });
  console.log("✅ Fixed: staff role policy reset to inherited (builtin defaults apply)");
} else {
  console.log("ℹ️ No fix needed: policy already inherited with full keys");
}