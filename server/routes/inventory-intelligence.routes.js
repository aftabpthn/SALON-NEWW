import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { backbarProductConsumptionService } from "../services/backbar-product-consumption.service.js";
import { inventoryEnterpriseService } from "../services/inventory-enterprise.service.js";
import { intelligentInventoryService } from "../services/intelligent-inventory.service.js";
import { purchaseBillDraftService } from "../services/purchase-bill-draft.service.js";
import { validateBody } from "../validators/request-validator.js";

export const inventoryIntelligenceRouter = Router();

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/summary",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(intelligentInventoryService.summary(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/usage",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(intelligentInventoryService.usageTracking(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/predictions",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(intelligentInventoryService.predictions(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/suppliers",
  requirePermission("write", () => "inventory"),
  validateBody({ required: ["name"] }),
  asyncHandler((req, res) => {
    res.status(201).json(intelligentInventoryService.createSupplier(req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-entry",
  requirePermission("write", () => "inventory"),
  validateBody({ required: ["productId", "branchId", "quantity"] }),
  asyncHandler((req, res) => {
    res.status(201).json(intelligentInventoryService.purchaseEntry(req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/batches",
  requirePermission("write", () => "inventory"),
  validateBody({ required: ["productId", "branchId", "batchNumber"] }),
  asyncHandler((req, res) => {
    res.status(201).json(intelligentInventoryService.createBatch(req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/waste",
  requirePermission("write", () => "inventory"),
  validateBody({ required: ["productId", "branchId", "quantity", "reason"] }),
  asyncHandler((req, res) => {
    res.status(201).json(intelligentInventoryService.recordWaste(req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/reorder-suggestions/run",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(intelligentInventoryService.runReorderSuggestions(req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/product-categories",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.listCategories(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/product-categories",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(purchaseBillDraftService.createCategory(req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/purchase-bill-drafts",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.listDrafts(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-bill-drafts/upload",
  requirePermission("write", () => "inventory"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await purchaseBillDraftService.createFromUpload(req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/purchase-bill-drafts/:id",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.getDraft(req.params.id, req.access));
  })
);

inventoryIntelligenceRouter.patch(
  "/inventory-intelligence/purchase-bill-drafts/:id",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.updateDraft(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-bill-drafts/:id/save-supplier",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.saveSupplierForDraft(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-bill-drafts/:id/match-po",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.matchPurchaseOrder(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-bill-drafts/:id/items",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(purchaseBillDraftService.addItem(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.patch(
  "/inventory-intelligence/purchase-bill-drafts/:id/items/:itemId",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.updateItem(req.params.id, req.params.itemId, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-bill-drafts/:id/items/:itemId/create-product",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.createProductFromDraftItem(req.params.id, req.params.itemId, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-bill-drafts/:id/confirm",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.confirmDraft(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-bill-drafts/:id/cancel",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(purchaseBillDraftService.cancelDraft(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/purchase-orders",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.listPurchaseOrders(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-orders",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(inventoryEnterpriseService.createPurchaseOrder(req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/purchase-orders/:id",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.getPurchaseOrder(req.params.id, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/purchase-orders/:id/bill-matches",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.purchaseOrderBillMatches(req.params.id, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-orders/:id/approve",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.approvePurchaseOrder(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-orders/:id/send",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.sendPurchaseOrder(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-orders/:id/receive",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.receivePurchaseOrder(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-orders/:id/close",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.closePurchaseOrder(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-orders/:id/cancel",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.cancelPurchaseOrder(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-orders/:id/reject",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.rejectPurchaseOrder(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/purchase-orders/:id/reopen",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.reopenPurchaseOrder(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/service-recipes",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.listServiceRecipes(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/service-recipes",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(inventoryEnterpriseService.saveServiceRecipe(req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/service-recipes/dashboard",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.serviceRecipeDashboard(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/service-recipes/templates",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.serviceRecipeTemplates(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/service-recipes/usage",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.listServiceRecipeUsage(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/service-recipes/alerts",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.listServiceRecipeAlerts(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/service-recipes/:id/submit-approval",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.submitServiceRecipeForApproval(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/service-recipes/:id/approve",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.approveServiceRecipe(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/service-recipes/:id/consume",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.consumeServiceRecipe({ ...req.body, serviceId: req.params.id }, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/backbar-owner-report",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(backbarProductConsumptionService.ownerReport(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/backbar-owner-dashboard",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(backbarProductConsumptionService.ownerDashboard(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/product-consumption-control-ledger",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(backbarProductConsumptionService.controlLedgerReport(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/backbar-products/:productId/report",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(backbarProductConsumptionService.productReport(req.params.productId, req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/backbar-containers/:id/adjust",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(backbarProductConsumptionService.adjustContainer(
      req.params.id,
      req.body,
      req.access,
      (stockPayload) => inventoryEnterpriseService.consumeProductFifo(stockPayload, req.access)
    ));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/backbar-container-scan",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(backbarProductConsumptionService.scanContainer(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/backbar-products/:productId/override-open",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(backbarProductConsumptionService.overrideOpenContainer(req.params.productId, req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/backbar-override-requests",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(backbarProductConsumptionService.listOverrideRequests(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/backbar-products/:productId/override-requests",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(backbarProductConsumptionService.requestOverrideOpen(req.params.productId, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/backbar-override-requests/:id/decision",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(backbarProductConsumptionService.decideOverrideRequest(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/product-consume-drafts",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.listProductConsumeDrafts(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/product-consume-drafts/:id",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.getProductConsumeDraft(req.params.id, req.access));
  })
);

inventoryIntelligenceRouter.patch(
  "/inventory-intelligence/product-consume-drafts/:id",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.updateProductConsumeDraft(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/product-consume-drafts/:id/confirm",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.confirmProductConsumeDraft(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/product-consume-drafts/from-invoice/:invoiceId",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.generateProductConsumeDraftsForInvoice(req.params.invoiceId, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/product-consume-report/:productId",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.productConsumeReport(req.params.productId, req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/staff-product-usage-audit",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.staffProductUsageAudit(req.query, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/stock-counts",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.listStockCounts(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/stock-counts",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(inventoryEnterpriseService.createStockCount(req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/stock-counts/:id/submit",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.submitStockCount(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/leakage-findings",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.leakageFindings(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/leakage-scan",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(inventoryEnterpriseService.runLeakageScan(req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/transfer-recommendations",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.transferRecommendations(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/transfer-requests",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(inventoryEnterpriseService.createTransferRequest(req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/transfer-requests/:id/approve",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.approveTransferRequest(req.params.id, req.body, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/barcode-scan",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(inventoryEnterpriseService.scanBarcode(req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/reports",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.inventoryReports(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/reports/snapshot",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.status(201).json(inventoryEnterpriseService.createReportSnapshot(req.body, req.access));
  })
);

inventoryIntelligenceRouter.get(
  "/inventory-intelligence/supplier-whatsapp-queue",
  requirePermission("read", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.supplierWhatsappQueue(req.query, req.access));
  })
);

inventoryIntelligenceRouter.post(
  "/inventory-intelligence/supplier-whatsapp-queue/:id/mark-sent",
  requirePermission("write", () => "inventory"),
  asyncHandler((req, res) => {
    res.json(inventoryEnterpriseService.markSupplierWhatsappSent(req.params.id, req.body, req.access));
  })
);
