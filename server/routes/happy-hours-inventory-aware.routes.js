import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursInventoryAwareRepo } from "../repositories/happy-hours-inventory-aware.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursInventoryAwareRouter = Router();

function scope(req) {
  const tenantId = req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || req.body?.tenantId || "";
  const branchId = req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || req.body?.branchId || "";
  if (!tenantId || !branchId) throw badRequest("tenantId and branchId are required");
  return { tenantId, branchId };
}

function input(req) {
  return {
    ...scope(req),
    productId: req.query.productId || req.body?.productId,
    serviceCategory: req.query.serviceCategory || req.body?.serviceCategory,
    signalDate: req.query.signalDate || req.body?.signalDate,
    servicePricePaise: req.query.servicePricePaise || req.body?.servicePricePaise,
    productPricePaise: req.query.productPricePaise || req.body?.productPricePaise,
    overstockThreshold: req.query.overstockThreshold || req.body?.overstockThreshold,
    lowStockThreshold: req.query.lowStockThreshold || req.body?.lowStockThreshold,
    expiryWindowDays: req.query.expiryWindowDays || req.body?.expiryWindowDays,
    limit: req.query.limit || req.body?.limit
  };
}

function asBadRequest(error, fallback) {
  return badRequest(error.message || fallback);
}

happyHoursInventoryAwareRouter.get(
  "/evaluate",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursInventoryAwareRepo.evaluate(input(req)));
    } catch (error) {
      throw asBadRequest(error, "Unable to evaluate inventory-aware offers");
    }
  })
);

happyHoursInventoryAwareRouter.get(
  "/suggestions",
  asyncHandler((req, res) => {
    res.json(happyHoursInventoryAwareRepo.listSuggestions({
      ...scope(req),
      status: req.query.status,
      limit: req.query.limit
    }));
  })
);

happyHoursInventoryAwareRouter.post(
  "/suggestions",
  asyncHandler((req, res) => {
    try {
      res.status(201).json({ suggestion: happyHoursInventoryAwareRepo.saveSuggestion(input(req)) });
    } catch (error) {
      throw asBadRequest(error, "Unable to save inventory-aware suggestion");
    }
  })
);

happyHoursInventoryAwareRouter.patch(
  "/suggestions/:id/status",
  asyncHandler((req, res) => {
    try {
      res.json({
        suggestion: happyHoursInventoryAwareRepo.updateStatus({
          ...scope(req),
          id: req.params.id,
          status: req.body?.status
        })
      });
    } catch (error) {
      throw asBadRequest(error, "Unable to update inventory-aware suggestion");
    }
  })
);
