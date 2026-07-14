import { Router } from "express";
import { authenticateJwt } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { staffBusinessService } from "../services/staff-business.service.js";
import { staffSelfResponsePresenterService } from "../services/staff-self-response-presenter.service.js";

export const staffBusinessRouter = Router();

staffBusinessRouter.get(
  "/staff-self/business/invoices/:invoiceId",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  requirePermission("read", () => "invoices"),
  asyncHandler((req, res) => res.json(staffSelfResponsePresenterService.invoiceDetail(staffBusinessService.invoiceDetail(req.params.invoiceId, req.access))))
);

staffBusinessRouter.get(
  "/staff-self/business",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => res.json(staffSelfResponsePresenterService.staffData(staffBusinessService.daily(req.query, req.access), req.access)))
);
