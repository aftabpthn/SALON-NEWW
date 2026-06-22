import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Inventory home exposes the final stock control tower", () => {
  const page = read("src/app/pages/inventory.component.ts");

  assert.match(page, /Inventory control tower/);
  assert.match(page, /Stock, FIFO, reorder, wastage and profit linkage/);
  assert.match(page, /AI reorder/);
  assert.match(page, /FIFO \/ expiry/);
  assert.match(page, /Service recipes/);
  assert.match(page, /Stock audit/);
  assert.match(page, /Product consume/);
  assert.match(page, /Supplier orders/);
  assert.match(page, /Profit link/);
  assert.match(page, /inventoryReadinessScore/);
  assert.match(page, /reorderReadinessLabel/);
});

test("Inventory pages keep the advanced operational links wired", () => {
  const page = read("src/app/pages/inventory.component.ts");

  for (const link of [
    "/inventory/reorder",
    "/inventory/fifo",
    "/inventory/recipes",
    "/inventory/stock-audit",
    "/inventory/reports",
    "/inventory/financial",
    "/inventory/product-consume",
    "/pos"
  ]) {
    assert.match(page, new RegExp(`routerLink="${link.replace(/\//g, "\\/")}"`), `${link} should remain linked`);
  }
  assert.match(page, /product360Link/);
  assert.match(page, /supplier360Link/);
});

test("Inventory backend exposes reorder, FIFO, recipes, product consume, audit, reports and supplier order APIs", () => {
  const routes = read("server/routes/inventory-intelligence.routes.js");
  const enterprise = read("server/services/inventory-enterprise.service.js");
  const intelligent = read("server/services/intelligent-inventory.service.js");

  for (const endpoint of [
    "/inventory-intelligence/summary",
    "/inventory-intelligence/reorder-suggestions/run",
    "/inventory-intelligence/service-recipes",
    "/inventory-intelligence/product-consume-drafts",
    "/inventory-intelligence/product-consume-drafts/from-invoice/:invoiceId",
    "/inventory-intelligence/stock-counts",
    "/inventory-intelligence/transfer-recommendations",
    "/inventory-intelligence/barcode-scan",
    "/inventory-intelligence/reports",
    "/inventory-intelligence/reports/snapshot",
    "/inventory-intelligence/supplier-whatsapp-queue"
  ]) {
    assert.ok(routes.includes(endpoint), `${endpoint} should be routed`);
  }
  assert.match(routes, /requirePermission\("read",\s*\(\) => "inventory"\)/);
  assert.match(routes, /requirePermission\("write",\s*\(\) => "inventory"\)/);
  assert.match(enterprise, /approval_status = 'approved'/);
  assert.match(enterprise, /inventory_report_snapshots/);
  assert.match(intelligent, /runReorderSuggestions/);
});

test("Inventory deduction and billing profit linkage are real, not placeholder", () => {
  const worker = read("server/workers/handlers/inventory-deduct.handler.js");
  const billingInventory = read("server/services/billing-inventory.service.js");
  const trueMargin = read("server/services/true-margin.service.js");
  const posInvoices = read("src/app/pages/pos-invoices.component.ts");

  assert.match(worker, /deductServiceUsage/);
  assert.match(worker, /applyInventoryDelta/);
  assert.doesNotMatch(worker, /queued-placeholder|TODO/);
  assert.match(billingInventory, /consumeProductFifo/);
  assert.match(billingInventory, /consumeServiceRecipe/);
  assert.match(trueMargin, /invoice_item_margins/);
  assert.match(trueMargin, /gross_margin/);
  assert.match(posInvoices, /Inventory\/profit/);
  assert.match(posInvoices, /inventory-intelligence\/product-consume-drafts/);
});
