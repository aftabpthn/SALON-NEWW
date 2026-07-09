import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../server/db.js";
import { can, requirePermission } from "../server/middleware/rbac.js";

const access = { tenantId: "tenant_aura" };

test("owner can manage every resource", () => {
  assert.equal(can("owner", "admin", "security", access), true);
  assert.equal(can("owner", "write", "finance", access), true);
});

test("accountant can manage finance but not inventory writes", () => {
  assert.equal(can("accountant", "write", "finance", access), true);
  assert.equal(can("accountant", "write", "inventory", access), false);
});

test("inventory manager can write inventory but not finance", () => {
  assert.equal(can("inventoryManager", "write", "inventory", access), true);
  assert.equal(can("inventoryManager", "write", "finance", access), false);
});

test("custom roles are resolved from persisted permissions", () => {
  assert.equal(can("customMarketingLead", "write", "marketing", access), true);
  assert.equal(can("customMarketingLead", "write", "finance", access), false);
});

test("role defaults keep POS and notifications need-based", () => {
  assert.equal(can("manager", "use", "pos", access), true);
  assert.equal(can("receptionist", "use", "pos", access), true);
  assert.equal(can("frontDesk", "use", "pos", access), true);
  assert.equal(can("cashier", "use", "pos", access), true);
  assert.equal(can("accountant", "use", "pos", access), false);
  assert.equal(can("inventoryManager", "use", "pos", access), false);
  assert.equal(can("analyst", "use", "pos", access), false);
  assert.equal(can("marketingLead", "read", "notifications", access), true);
  assert.equal(can("customMarketingLead", "read", "notifications", access), true);
});

test("custom roles can explicitly grant POS access", () => {
  db.prepare("SAVEPOINT rbac_custom_pos").run();
  try {
    db.prepare("DELETE FROM security_permissions WHERE tenantId = @tenantId AND role = @role AND resource = @resource")
      .run({ tenantId: access.tenantId, role: "customMarketingLead", resource: "pos" });
    db.prepare(`INSERT INTO security_permissions (
      id, tenantId, role, resource, actions, effect, conditions, status, createdAt, updatedAt
    ) VALUES (
      @id, @tenantId, @role, @resource, @actions, @effect, @conditions, @status, @createdAt, @updatedAt
    )`).run({
      id: "perm_test_custom_pos",
      tenantId: access.tenantId,
      role: "customMarketingLead",
      resource: "pos",
      actions: JSON.stringify(["use"]),
      effect: "allow",
      conditions: "{}",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.equal(can("customMarketingLead", "use", "pos", access), true);
  } finally {
    db.prepare("ROLLBACK TO rbac_custom_pos").run();
    db.prepare("RELEASE rbac_custom_pos").run();
  }
});

test("capped system roles ignore persisted rows for the same resource", () => {
  db.prepare("SAVEPOINT rbac_system_cap").run();
  try {
    db.prepare("DELETE FROM security_permissions WHERE tenantId = @tenantId AND role = @role AND resource = @resource")
      .run({ tenantId: access.tenantId, role: "manager", resource: "finance" });
    db.prepare(`INSERT INTO security_permissions (
      id, tenantId, role, resource, actions, effect, conditions, status, createdAt, updatedAt
    ) VALUES (
      @id, @tenantId, @role, @resource, @actions, @effect, @conditions, @status, @createdAt, @updatedAt
    )`).run({
      id: "perm_test_manager_finance",
      tenantId: access.tenantId,
      role: "manager",
      resource: "finance",
      actions: JSON.stringify(["read", "update"]),
      effect: "allow",
      conditions: "{}",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.equal(can("manager", "read", "finance", access), false);
    assert.equal(can("manager", "update", "finance", access), false);
  } finally {
    db.prepare("ROLLBACK TO rbac_system_cap").run();
    db.prepare("RELEASE rbac_system_cap").run();
  }
});

test("empty deny rows are authoritative for unchecked micro permissions", () => {
  db.prepare("SAVEPOINT rbac_empty_deny").run();
  try {
    db.prepare("DELETE FROM security_permissions WHERE tenantId = @tenantId AND role = @role AND resource = @resource")
      .run({ tenantId: access.tenantId, role: "manager", resource: "limited-permission-assignment" });
    db.prepare(`INSERT INTO security_permissions (
      id, tenantId, role, resource, actions, effect, conditions, status, createdAt, updatedAt
    ) VALUES (
      @id, @tenantId, @role, @resource, @actions, @effect, @conditions, @status, @createdAt, @updatedAt
    )`).run({
      id: "perm_test_manager_limited_permission",
      tenantId: access.tenantId,
      role: "manager",
      resource: "limited-permission-assignment",
      actions: JSON.stringify([]),
      effect: "deny",
      conditions: "{}",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.equal(can("manager", "allow", "limited-permission-assignment", access), false);
    assert.equal(can("manager", "read", "limited-permission-assignment", access), false);
  } finally {
    db.prepare("ROLLBACK TO rbac_empty_deny").run();
    db.prepare("RELEASE rbac_empty_deny").run();
  }
});

test("failed permission checks are audited", () => {
  db.prepare("SAVEPOINT rbac_denied_audit").run();
  try {
    const before = db.prepare("SELECT COUNT(*) total FROM security_audit_logs WHERE action = 'access.forbidden' AND targetType = 'finance'").get();
    const req = {
      method: "POST",
      path: "/finance/refunds",
      originalUrl: "/api/v1/finance/refunds",
      params: {},
      access: { tenantId: access.tenantId, branchId: "branch_main", role: "staff", userId: "qa_staff" },
      get(name) {
        return name === "user-agent" ? "rbac-test" : "";
      }
    };
    let error;
    requirePermission("write", () => "finance")(req, {}, (nextError) => {
      error = nextError;
    });
    assert.ok(error, "forbidden error should be passed to next");
    const after = db.prepare("SELECT COUNT(*) total FROM security_audit_logs WHERE action = 'access.forbidden' AND targetType = 'finance'").get();
    assert.equal(Number(after.total), Number(before.total) + 1);
  } finally {
    db.prepare("ROLLBACK TO rbac_denied_audit").run();
    db.prepare("RELEASE rbac_denied_audit").run();
  }
});

