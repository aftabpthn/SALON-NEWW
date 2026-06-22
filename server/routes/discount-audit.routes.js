import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { discountAuditLogRepo } from "../repositories/discount-audit-log.repo.js";
import { badRequest } from "../utils/app-error.js";

export const discountAuditRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

discountAuditRouter.get(
  "/log",
  asyncHandler((req, res) => {
    res.json(discountAuditLogRepo.query({
      ...requireScope(req),
      from: req.query.from,
      to: req.query.to,
      eventType: req.query.eventType,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

discountAuditRouter.get(
  "/rule/:ruleId/history",
  asyncHandler((req, res) => {
    res.json(discountAuditLogRepo.getRuleHistory({
      ...requireScope(req),
      ruleId: req.params.ruleId,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

discountAuditRouter.get(
  "/compliance-report",
  asyncHandler((req, res) => {
    res.json(discountAuditLogRepo.getComplianceReport({
      ...requireScope(req),
      from: req.query.from,
      to: req.query.to
    }));
  })
);
