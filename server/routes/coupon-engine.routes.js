import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { couponEngineRepo } from "../repositories/coupon-engine.repo.js";
import { badRequest, notFound } from "../utils/app-error.js";

export const couponEngineRouter = Router();

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

function withScope(req) {
  const current = requireScope(req);
  return {
    ...req.body,
    tenantId: current.tenantId,
    branchId: current.branchId,
    createdBy: req.body?.createdBy || current.userId || null
  };
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid coupon engine request");
}

couponEngineRouter.get(
  "/templates",
  asyncHandler((_req, res) => {
    res.json({ rows: couponEngineRepo.templates() });
  })
);

couponEngineRouter.get(
  "/analytics",
  asyncHandler((req, res) => {
    try {
      res.json(couponEngineRepo.analytics(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

couponEngineRouter.get(
  "/",
  asyncHandler((req, res) => {
    try {
      res.json(couponEngineRepo.listCoupons({
        ...requireScope(req),
        status: req.query.status,
        offerType: req.query.offerType,
        limit: req.query.limit,
        offset: req.query.offset
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

couponEngineRouter.post(
  "/",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(couponEngineRepo.createCoupon(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

couponEngineRouter.patch(
  "/:id",
  asyncHandler((req, res) => {
    try {
      const row = couponEngineRepo.updateCoupon({ ...withScope(req), id: req.params.id });
      if (!row) throw notFound("Coupon not found");
      res.json(row);
    } catch (error) {
      if (error.statusCode === 404) throw error;
      throw asBadRequest(error);
    }
  })
);

couponEngineRouter.post(
  "/validate",
  asyncHandler((req, res) => {
    try {
      res.json(couponEngineRepo.validateCoupon(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

couponEngineRouter.post(
  "/redeem",
  asyncHandler((req, res) => {
    try {
      res.json(couponEngineRepo.redeemCoupon(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
