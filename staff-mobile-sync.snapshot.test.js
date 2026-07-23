import assert from "node:assert/strict";
import test from "node:test";
import { db } from "./server/db.js";
import { staffMobileSyncService } from "./server/services/staff-mobile-sync.service.js";
import { staffOsService } from "./server/services/staff-os.service.js";

const tenantId = "snapshot_test_tenant";
const branchId = "snapshot_test_branch";
const managerStaffId = "snapshot_test_manager";
const targetStaffId = "snapshot_test_target";

db.exec(`
  CREATE TABLE IF NOT EXISTS staff_master (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    employee_code TEXT,
    first_name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    status TEXT DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS staff_mobile_snapshots (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    snapshot_json TEXT DEFAULT '{}',
    sync_token TEXT NOT NULL
  );
`);

function insertStaff(id, employeeCode) {
  db.prepare(`INSERT OR REPLACE INTO staff_master
    (id, tenant_id, branch_id, employee_code, first_name, full_name, status)
    VALUES (@id, @tenantId, @branchId, @employeeCode, @firstName, @fullName, 'active')`).run({
    id,
    tenantId,
    branchId,
    employeeCode,
    firstName: employeeCode,
    fullName: employeeCode
  });
}

function cleanup() {
  db.prepare("DELETE FROM staff_mobile_snapshots WHERE tenant_id = @tenantId").run({ tenantId });
  db.prepare("DELETE FROM staff_master WHERE tenant_id = @tenantId").run({ tenantId });
}

test("manager snapshot clears manager staff identity and pins target branch", () => {
  cleanup();
  insertStaff(managerStaffId, "SNAP-MANAGER");
  insertStaff(targetStaffId, "SNAP-TARGET");
  const originalMobileToday = staffOsService.mobileToday;
  const originalListTasks = staffOsService.listTasks;
  const calls = [];
  staffOsService.mobileToday = (query, access) => {
    calls.push({ method: "mobileToday", query, access });
    return { date: query.date || "" };
  };
  staffOsService.listTasks = (query, access) => {
    calls.push({ method: "listTasks", query, access });
    return [];
  };

  try {
    staffMobileSyncService.snapshot({ staffId: targetStaffId, branchId }, {
      tenantId,
      role: "manager",
      userId: "snapshot_manager_user",
      staffId: managerStaffId,
      branchId,
      requestedBranchId: branchId,
      branchIds: [branchId]
    });
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.query.staffId, targetStaffId);
      assert.equal(call.access.staffId, "");
      assert.equal(call.access.tenantId, tenantId);
      assert.equal(call.access.branchId, branchId);
      assert.equal(call.access.requestedBranchId, branchId);
    }
  } finally {
    staffOsService.mobileToday = originalMobileToday;
    staffOsService.listTasks = originalListTasks;
    cleanup();
  }
});

test("ordinary linked staff snapshot remains self-only", () => {
  cleanup();
  insertStaff(managerStaffId, "SNAP-SELF");
  insertStaff(targetStaffId, "SNAP-OTHER");
  const originalMobileToday = staffOsService.mobileToday;
  const originalListTasks = staffOsService.listTasks;
  const calls = [];
  staffOsService.mobileToday = (query, access) => {
    calls.push({ query, access });
    return {};
  };
  staffOsService.listTasks = (query, access) => {
    calls.push({ query, access });
    return [];
  };
  try {
    const snapshot = staffMobileSyncService.snapshot({ staffId: targetStaffId }, {
      tenantId,
      role: "staff",
      userId: "snapshot_staff_user",
      staffId: managerStaffId,
      branchId,
      requestedBranchId: branchId,
      branchIds: [branchId]
    });
    assert.equal(snapshot.staff.id, managerStaffId);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.query.staffId, managerStaffId);
      assert.equal(call.access.staffId, managerStaffId);
      assert.equal(call.access.branchId, branchId);
    }
  } finally {
    staffOsService.mobileToday = originalMobileToday;
    staffOsService.listTasks = originalListTasks;
    cleanup();
  }
});

test("manager snapshot rejects a target outside authorized branches", () => {
  cleanup();
  insertStaff(targetStaffId, "SNAP-OUTSIDE");
  try {
    assert.throws(() => staffMobileSyncService.snapshot({ staffId: targetStaffId }, {
      tenantId,
      role: "manager",
      userId: "snapshot_manager_user",
      staffId: managerStaffId,
      branchId: "snapshot_other_branch",
      requestedBranchId: "snapshot_other_branch",
      branchIds: ["snapshot_other_branch"]
    }), /does not have access to the requested branch/i);
  } finally {
    cleanup();
  }
});
