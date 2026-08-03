import { Router } from "express";
import { authenticateJwt } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireStaffAppSelfPermission } from "../middleware/rbac.js";
import { staffBusinessService } from "../services/staff-business.service.js";
import { applyCachedResponseHeaders, cachedStaffRead } from "../services/staff-dashboard-cache.service.js";
import { staffSelfResponsePresenterService } from "../services/staff-self-response-presenter.service.js";

export const staffBusinessRouter = Router();

staffBusinessRouter.get(
  "/staff-self/business/invoices/:invoiceId",
  authenticateJwt(),
  requireStaffAppSelfPermission("read", "staff-app-appointments"),
  requireStaffAppSelfPermission("read", "staff-app-invoices"),
  asyncHandler((req, res) => res.json(staffSelfResponsePresenterService.invoiceDetail(staffBusinessService.invoiceDetail(req.params.invoiceId, req.access))))
);

staffBusinessRouter.get(
  "/staff-self/business",
  authenticateJwt(),
  requireStaffAppSelfPermission("read", "staff-app-appointments"),
  asyncHandler((req, res) => {
    const data = cachedStaffRead(
      req.query,
      req.access,
      (query, access) => staffSelfResponsePresenterService.staffData(staffBusinessService.daily(query, access), access),
      10_000
    );
    applyCachedResponseHeaders(res, data, 10);
    res.json(data);
  })
);
