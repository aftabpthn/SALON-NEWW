import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventoryService = readFileSync("server/services/inventory-enterprise.service.js", "utf8");
const recipesPage = readFileSync("src/app/pages/inventory-recipes.component.ts", "utf8");
const modulePage = readFileSync("src/app/pages/module-page.component.ts", "utf8");
const appRoutes = readFileSync("src/app/app.routes.ts", "utf8");
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

test("services form owns product wastage lock controls", () => {
  assert.match(modulePage, /serviceProductLocks/);
  assert.match(modulePage, /Product consumption/);
  assert.match(modulePage, /Min qty/);
  assert.match(modulePage, /Standard qty/);
  assert.match(modulePage, /Max qty/);
  assert.match(modulePage, /Owner approval %/);
  assert.match(modulePage, /Hit limit/);
  assert.match(modulePage, /inventory-intelligence\/service-recipes/);
  assert.match(modulePage, /payload\.requiredProducts = this\.serviceProductLockPayload\(\)/);
  assert.doesNotMatch(appRoutes, /Required products JSON/);
});

test("recipe editor no longer duplicates hair spa preset lock controls", () => {
  assert.doesNotMatch(recipesPage, /Hair spa 20\/40\/60 preset/);
  assert.doesNotMatch(recipesPage, /applyHairSpaPreset/);
  assert.doesNotMatch(recipesPage, /name: 'Hair Spa'/);
  assert.doesNotMatch(recipesPage, /Waste lock %/);
  assert.match(productConsumePage, /Auto waste/);
});

test("product consume drafts fallback to service required products", () => {
  assert.match(inventoryService, /serviceRequiredProductDraftLines/);
  assert.match(inventoryService, /service\.requiredProducts/);
  assert.match(inventoryService, /recipeLineItems\.length \? recipeLineItems : fallbackLineItems/);
  assert.match(inventoryService, /Auto draft from service product lock/);
  assert.match(inventoryService, /status: lineItems\.length \? "draft" : "recipe_missing"/);
});
