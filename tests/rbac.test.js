import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../server/db.js";
import { can } from "../server/middleware/rbac.js";

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

test("explicit tenant rows override static manager grants for the same resource", () => {
  db.prepare("SAVEPOINT rbac_static_override").run();
  try {
    db.prepare("DELETE FROM security_permissions WHERE tenantId = @tenantId AND role = @role AND resource = @resource")
      .run({ tenantId: access.tenantId, role: "manager", resource: "products" });
    db.prepare(`INSERT INTO security_permissions (
      id, tenantId, role, resource, actions, effect, conditions, status, createdAt, updatedAt
    ) VALUES (
      @id, @tenantId, @role, @resource, @actions, @effect, @conditions, @status, @createdAt, @updatedAt
    )`).run({
      id: "perm_test_manager_products",
      tenantId: access.tenantId,
      role: "manager",
      resource: "products",
      actions: JSON.stringify(["read", "update"]),
      effect: "allow",
      conditions: "{}",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.equal(can("manager", "read", "products", access), true);
    assert.equal(can("manager", "update", "products", access), true);
    assert.equal(can("manager", "delete", "products", access), false);
  } finally {
    db.prepare("ROLLBACK TO rbac_static_override").run();
    db.prepare("RELEASE rbac_static_override").run();
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

