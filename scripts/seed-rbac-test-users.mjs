import { scryptSync } from "node:crypto";
import { db } from "../server/db.js";

const tenantId = process.env.RBAC_TEST_TENANT_ID || "tenant_aura";
const branchId = process.env.RBAC_TEST_BRANCH_ID || "branch_main";
const password = process.env.RBAC_TEST_PASSWORD || "AuraTest@12345";
const now = new Date().toISOString();

const roles = [
  "owner",
  "manager",
  "frontDesk",
  "receptionist",
  "cashier",
  "accountant",
  "inventoryManager",
  "staff",
  "customMarketingLead"
];

function passwordHashFor(rawPassword, salt) {
  return scryptSync(String(rawPassword || ""), salt, 64).toString("hex");
}

function userForRole(role) {
  const loginId = `qa_${role.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
  const salt = `aura-qa-${role}-salt`;
  return {
    id: `qa_user_${role.replace(/[^a-z0-9]+/gi, "_")}`,
    tenantId,
    name: `QA ${role}`,
    loginId,
    email: `${loginId}@aura.local`,
    role,
    branchIds: JSON.stringify([branchId]),
    staffId: role === "staff" ? "qa_staff_member" : "",
    passwordSalt: salt,
    passwordHash: passwordHashFor(password, salt),
    failedLoginCount: 0,
    lockedUntil: "",
    lastLoginAt: "",
    status: "active",
    accessApprovedBy: "seed-rbac-test-users",
    accessApprovedAt: now,
    permissionVersion: 1,
    createdAt: now,
    updatedAt: now
  };
}

const selectExisting = db.prepare("SELECT id FROM tenant_users WHERE tenantId = @tenantId AND lower(email) = lower(@email)");
const insertUser = db.prepare(`INSERT INTO tenant_users (
  id, tenantId, name, loginId, email, role, branchIds, staffId,
  passwordSalt, passwordHash, failedLoginCount, lockedUntil, lastLoginAt, status,
  accessApprovedBy, accessApprovedAt, permissionVersion, createdAt, updatedAt
) VALUES (
  @id, @tenantId, @name, @loginId, @email, @role, @branchIds, @staffId,
  @passwordSalt, @passwordHash, @failedLoginCount, @lockedUntil, @lastLoginAt, @status,
  @accessApprovedBy, @accessApprovedAt, @permissionVersion, @createdAt, @updatedAt
)`);
const updateUser = db.prepare(`UPDATE tenant_users
   SET name = @name,
       loginId = @loginId,
       role = @role,
       branchIds = @branchIds,
       staffId = @staffId,
       passwordSalt = @passwordSalt,
       passwordHash = @passwordHash,
       status = @status,
       accessApprovedBy = @accessApprovedBy,
       accessApprovedAt = @accessApprovedAt,
       permissionVersion = COALESCE(permissionVersion, 1) + 1,
       updatedAt = @updatedAt
 WHERE tenantId = @tenantId AND lower(email) = lower(@email)`);

const created = [];
const updated = [];
const tx = db.transaction(() => {
  roles.forEach((role) => {
    const row = userForRole(role);
    if (selectExisting.get(row)) {
      updateUser.run(row);
      updated.push(row.email);
      return;
    }
    insertUser.run(row);
    created.push(row.email);
  });
});

tx();

console.log(JSON.stringify({ tenantId, branchId, password, created, updated }, null, 2));
