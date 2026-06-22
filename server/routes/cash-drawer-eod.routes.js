import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { cashDrawerEodService } from "../services/cash-drawer-eod.service.js";

export const cashDrawerEodRouter = Router();
export const cashDrawerEodPublicRouter = Router();

cashDrawerEodPublicRouter.get("/cash-drawer-eod/approval-token/:token", asyncHandler((req, res) => {
  res.json(cashDrawerEodService.riskApprovalByToken(req.params.token));
}));

cashDrawerEodPublicRouter.post("/cash-drawer-eod/approval-token/:token/review", asyncHandler((req, res) => {
  res.json(cashDrawerEodService.reviewRiskApprovalByToken(req.params.token, req.body));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/open", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.status(201).json(cashDrawerEodService.open(req.body, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/current", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.current(req.query, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/risk-dashboard", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.ownerRiskDashboard(req.query, req.access));
}));

cashDrawerEodRouter.put("/cash-drawer-eod/:id/cash", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.setCash(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/operations", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.listCashOperations(req.params.id, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/:id/operations", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.status(201).json(cashDrawerEodService.createCashOperation(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.patch("/cash-drawer-eod/operations/:operationId", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.updateCashOperation(req.params.operationId, req.body, req.access));
}));

cashDrawerEodRouter.delete("/cash-drawer-eod/operations/:operationId", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.deleteCashOperation(req.params.operationId, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/:id/tills", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.status(201).json(cashDrawerEodService.createTill(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/tills/:tillId/close", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.closeTill(req.params.tillId, req.body, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/:id/handover", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.status(201).json(cashDrawerEodService.handover(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/float-suggestion", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.floatSuggestion(req.params.id, req.access));
}));

cashDrawerEodRouter.put("/cash-drawer-eod/:id/denominations", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.setDenominations(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/:id/settlement", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.status(201).json(cashDrawerEodService.upsertSettlement(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.patch("/cash-drawer-eod/settlement/:settlementId", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.patchSettlement(req.params.settlementId, req.body, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/pending-settlements", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.pendingSettlements(req.query, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/three-way", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.threeWayReconciliation(req.params.id, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/exceptions", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.reconciliationExceptions(req.params.id, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/:id/settlement-import", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.status(201).json(cashDrawerEodService.importSettlementCsv(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/:id/deposit-slip", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.status(201).json(cashDrawerEodService.createDepositSlip(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.patch("/cash-drawer-eod/deposit-slip/:depositSlipId", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.confirmDepositSlip(req.params.depositSlipId, req.body, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/accounting", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.accountingSummary(req.params.id, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/:id/accounting/post", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.postAccounting(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/tax-register", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.taxRegister(req.params.id, req.query, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/tally-export", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.tallyExport(req.params.id, req.query, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/risk", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.riskSummary(req.params.id, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/:id/approval-request", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.status(201).json(cashDrawerEodService.requestRiskApproval(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/approval-requests/:requestId/review", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.reviewRiskApproval(req.params.requestId, req.body, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/summary", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.summary(req.params.id, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/:id/can-close", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.canClose(req.params.id, req.access));
}));

cashDrawerEodRouter.post("/cash-drawer-eod/:id/close", requirePermission("write", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.close(req.params.id, req.body, req.access));
}));

cashDrawerEodRouter.get("/cash-drawer-eod/reports/today", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(cashDrawerEodService.todayReport(req.query, req.access));
}));
