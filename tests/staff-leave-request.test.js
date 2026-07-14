import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../server/db.js";
import { staffLeaveRequestService } from "../server/services/staff-leave-request.service.js";
import { staffOsService } from "../server/services/staff-os.service.js";

test("leave requests validate input and reuse an identical pending request", () => {
  const savepoint = `staff_leave_${randomUUID().replaceAll("-", "")}`;
  const staff = db.prepare(`SELECT id, tenant_id AS tenantId, branch_id AS branchId
    FROM staff_master WHERE status = 'active' ORDER BY created_at LIMIT 1`).get();
  assert.ok(staff, "test needs an active staff member");

  const configuredType = db.prepare(`SELECT code FROM staff_leave_type_master
    WHERE tenant_id = @tenantId AND status = 'active' AND (branch_id = @branchId OR branch_id = '')
    ORDER BY code LIMIT 1`).get(staff)?.code || "casual";
  const access = {
    tenantId: staff.tenantId,
    branchId: staff.branchId,
    requestedBranchId: staff.branchId,
    branchIds: [staff.branchId],
    role: "owner",
    userId: "leave-test"
  };
  const payload = {
    branchId: staff.branchId,
    staffId: staff.id,
    leaveType: configuredType,
    startDate: "2099-12-30",
    endDate: "2099-12-30",
    reason: "Focused duplicate check"
  };
  const originalEmit = staffOsService.emit;
  const originalWriteAudit = staffOsService.writeAudit;
  const before = db.prepare("SELECT COUNT(*) AS count FROM staff_leaves").get().count;

  db.exec(`SAVEPOINT ${savepoint}`);
  staffOsService.emit = () => {};
  staffOsService.writeAudit = () => null;
  try {
    assert.throws(() => staffLeaveRequestService.requestLeave({ ...payload, leaveType: "bad/type" }, access), /leaveType is invalid/);
    assert.throws(() => staffLeaveRequestService.requestLeave({ ...payload, startDate: "2099-02-30" }, access), /startDate must be a valid/);
    assert.throws(() => staffLeaveRequestService.requestLeave({ ...payload, endDate: "2099-12-29" }, access), /endDate cannot be before/);

    const created = staffLeaveRequestService.requestLeave(payload, access);
    const duplicate = staffLeaveRequestService.requestLeave(payload, access);
    const inside = db.prepare("SELECT COUNT(*) AS count FROM staff_leaves").get().count;

    assert.equal(created.status, "pending");
    assert.equal(duplicate.id, created.id);
    assert.equal(duplicate.duplicate, true);
    assert.equal(inside, before + 1);
  } finally {
    staffOsService.emit = originalEmit;
    staffOsService.writeAudit = originalWriteAudit;
    db.exec(`ROLLBACK TO ${savepoint}`);
    db.exec(`RELEASE ${savepoint}`);
  }

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM staff_leaves").get().count, before);
});
