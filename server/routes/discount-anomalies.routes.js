import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { discountAnomaliesRepo } from "../repositories/discount-anomalies.repo.js";
import { scanDiscountAnomalies } from "../utils/discount-anomaly-detector.js";
import { badRequest } from "../utils/app-error.js";

export const discountAnomaliesRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.body?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.body?.branchId || req.query?.branchId || "",
    userId: req.access?.userId || req.header("x-user-id") || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid anomaly request");
}

discountAnomaliesRouter.get(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    res.json(discountAnomaliesRepo.listAnomalies({
      ...current,
      status: req.query.status,
      severity: req.query.severity,
      anomalyType: req.query.anomalyType,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

discountAnomaliesRouter.post(
  "/scan",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      res.json(scanDiscountAnomalies({
        ...current,
        from: req.body?.from || req.query?.from,
        to: req.body?.to || req.query?.to
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

discountAnomaliesRouter.patch(
  "/:id/review",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      res.json(discountAnomaliesRepo.markReviewed({
        ...current,
        id: req.params.id,
        status: req.body?.status || "reviewed",
        reviewedBy: req.body?.reviewedBy || current.userId || null,
        reviewNote: req.body?.reviewNote || req.body?.note || ""
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
