import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody } from "../validators/request-validator.js";
import { discountApprovalService } from "../services/discount-approval.service.js";
import { couponAbuseService } from "../services/coupon-abuse.service.js";

export const discountApprovalRouter = Router();

discountApprovalRouter.post("/discounts/request-approval", requirePermission("write", () => "invoices"), validateBody({ required: ["invoiceId"] }), asyncHandler((req, res) => res.status(201).json(discountApprovalService.request(req.body, req.access))));
discountApprovalRouter.post("/discounts/requests/:id/approve", requirePermission("write", () => "finance"), asyncHandler((req, res) => res.json(discountApprovalService.approve(req.params.id, req.body, req.access))));
discountApprovalRouter.post("/discounts/requests/:id/reject", requirePermission("write", () => "finance"), asyncHandler((req, res) => res.json(discountApprovalService.reject(req.params.id, req.body, req.access))));
discountApprovalRouter.get("/discounts/pending", requirePermission("read", () => "finance"), asyncHandler((req, res) => res.json(discountApprovalService.pending(req.access))));
discountApprovalRouter.get("/coupon-abuse/alerts", requirePermission("read", () => "finance"), asyncHandler((req, res) => res.json(couponAbuseService.alerts(req.query, req.access))));
discountApprovalRouter.post("/coupon-abuse/alerts/:id/resolve", requirePermission("write", () => "finance"), asyncHandler((req, res) => res.json(couponAbuseService.resolve(req.params.id, req.body, req.access))));
