import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursMarketAwareRepo } from "../repositories/happy-hours-market-aware.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursMarketAwareRouter = Router();

function scope(req) {
  const tenantId = req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || req.body?.tenantId || "";
  const branchId = req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || req.body?.branchId || "";
  if (!tenantId || !branchId) throw badRequest("tenantId and branchId are required");
  return { tenantId, branchId };
}

function input(req) {
  return {
    ...scope(req),
    serviceCategory: req.query.serviceCategory || req.body?.serviceCategory,
    signalDate: req.query.signalDate || req.body?.signalDate,
    dayOfWeek: req.query.dayOfWeek || req.body?.dayOfWeek,
    hourSlot: req.query.hourSlot || req.body?.hourSlot,
    ourPricePaise: req.query.ourPricePaise || req.body?.ourPricePaise,
    baseDiscountPercent: req.query.baseDiscountPercent || req.body?.baseDiscountPercent,
    maxDiscountPercent: req.query.maxDiscountPercent || req.body?.maxDiscountPercent
  };
}

function asBadRequest(error, fallback) {
  return badRequest(error.message || fallback);
}

happyHoursMarketAwareRouter.get(
  "/evaluate",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursMarketAwareRepo.evaluate(input(req)));
    } catch (error) {
      throw asBadRequest(error, "Unable to evaluate market-aware offers");
    }
  })
);

happyHoursMarketAwareRouter.get(
  "/suggestions",
  asyncHandler((req, res) => {
    res.json(happyHoursMarketAwareRepo.listSuggestions({
      ...scope(req),
      status: req.query.status,
      limit: req.query.limit
    }));
  })
);

happyHoursMarketAwareRouter.post(
  "/suggestions",
  asyncHandler((req, res) => {
    try {
      res.status(201).json({ suggestion: happyHoursMarketAwareRepo.saveSuggestion(input(req)) });
    } catch (error) {
      throw asBadRequest(error, "Unable to save market-aware suggestion");
    }
  })
);

happyHoursMarketAwareRouter.patch(
  "/suggestions/:id/status",
  asyncHandler((req, res) => {
    try {
      res.json({
        suggestion: happyHoursMarketAwareRepo.updateStatus({
          ...scope(req),
          id: req.params.id,
          status: req.body?.status
        })
      });
    } catch (error) {
      throw asBadRequest(error, "Unable to update market-aware suggestion");
    }
  })
);
