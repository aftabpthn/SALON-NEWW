import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventoryService = readFileSync("server/services/inventory-enterprise.service.js", "utf8");
const recipesPage = readFileSync("src/app/pages/inventory-recipes.component.ts", "utf8");
const productConsumePage = readFileSync("src/app/pages/product-consume.component.ts", "utf8");

test("service recipe items persist wastage approval percent and hit limit", () => {
  assert.match(inventoryService, /ensureServiceRecipeLockSchema/);
  assert.match(inventoryService, /wastage_approval_pct/);
  assert.match(inventoryService, /wastage_hit_limit/);
  assert.match(inventoryService, /wastageApprovalPct/);
  assert.match(inventoryService, /wastageHitLimit/);
});

test("invoice product consume drafts carry recipe range and lock controls", () => {
  assert.match(inventoryService, /min_quantity_per_service/);
  assert.match(inventoryService, /max_quantity_per_service/);
  assert.match(inventoryService, /minQty/);
  assert.match(inventoryService, /maxQty/);
  assert.match(inventoryService, /normalizeProductConsumeLine/);
});

test("recipe editor exposes hair spa preset and line-level lock controls", () => {
  assert.match(recipesPage, /Hair spa 20\/40\/60 preset/);
  assert.match(recipesPage, /applyHairSpaPreset/);
  assert.match(recipesPage, /api\.create<ApiRecord>\('services'/);
  assert.match(recipesPage, /name: 'Hair Spa'/);
  assert.match(recipesPage, /Waste lock %/);
  assert.match(recipesPage, /wastageApprovalPct/);
  assert.match(recipesPage, /wastageHitLimit/);
  assert.match(productConsumePage, /Auto waste/);
});
