import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventoryService = readFileSync("server/services/inventory-enterprise.service.js", "utf8");
const backbarService = readFileSync("server/services/backbar-product-consumption.service.js", "utf8");
const page = readFileSync("src/app/pages/product-consume.component.ts", "utf8");

test("product consume confirmation is locked by wastage owner approval", () => {
  assert.match(inventoryService, /PRODUCT_CONSUME_WASTAGE_OWNER_APPROVAL_PCT = 25/);
  assert.match(inventoryService, /productConsumeWastageGuard/);
  assert.match(inventoryService, /autoWastagePct/);
  assert.match(inventoryService, /ownerRoles\.has\(access\.role\)/);
  assert.match(inventoryService, /ownerApproval/);
  assert.match(inventoryService, /inventory:product_consume_wastage_approval_required/);
  assert.match(inventoryService, /inventory\.product_consume\.wastage_owner_approved/);
});

test("product consume owner report surfaces wastage approval and repeat staff actions", () => {
  assert.match(backbarService, /wastageApprovalRequired/);
  assert.match(backbarService, /staffWastageRepeatRows/);
  assert.match(backbarService, /wastage_owner_approval/);
  assert.match(backbarService, /staff_wastage_repeat/);
  assert.match(backbarService, /staffWastageRepeats/);
});

test("product consume UI shows wastage lock and role-aware confirm", () => {
  assert.match(page, /wastage-guard/);
  assert.match(page, /draftWastageGuard/);
  assert.match(page, /autoWastePct/);
  assert.match(page, /draftConfirmBlocked/);
  assert.match(page, /Owner approve & confirm/);
  assert.match(page, /ownerApproval: guard\.approvalRequired && this\.isOwnerApprover\(\)/);
  assert.match(page, /Staff waste hits/);
});

test("product consume UI hides blank extra product row until requested", () => {
  assert.match(page, /Add extra product/);
  assert.match(page, /extraProductOpen/);
  assert.match(page, /openExtraProduct/);
  assert.match(page, /cancelExtraProduct/);
  assert.match(page, /lineEditing/);
  assert.match(page, />Edit<\/button>/);
  assert.match(page, />Done<\/button>/);
  assert.match(page, /Product name locked|line\.productName \|\| line\.productId/);
  assert.match(page, /if \(!this\.extraProductOpen\)/);
});
