import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody } from "../validators/request-validator.js";
import { staffCommissionService } from "../services/staff-commission.service.js";
import { tipsService } from "../services/tips.service.js";

export const commissionRouter = Router();

commissionRouter.get("/commissions/staff/:staffId", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(staffCommissionService.staffReport(req.params.staffId, req.query, req.access));
}));

commissionRouter.get("/commissions/summary", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(staffCommissionService.summary(req.query, req.access));
}));

commissionRouter.post("/billing/invoices/:invoiceId/tips", requirePermission("write", () => "payments"), validateBody({ required: ["amount"] }), asyncHandler((req, res) => {
  res.status(201).json(tipsService.addTip(req.params.invoiceId, req.body, req.access));
}));

commissionRouter.get("/tips/report", requirePermission("read", () => "finance"), asyncHandler((req, res) => {
  res.json(tipsService.report(req.query, req.access));
}));
