import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursBundleAwareRepo } from "../repositories/happy-hours-bundle-aware.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursBundleAwareRouter = Router();

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
    primaryServiceId: req.query.primaryServiceId || req.body?.primaryServiceId,
    signalDate: req.query.signalDate || req.body?.signalDate,
    dayOfWeek: req.query.dayOfWeek || req.body?.dayOfWeek,
    hourSlot: req.query.hourSlot || req.body?.hourSlot,
    selectedServiceCount: req.query.selectedServiceCount || req.body?.selectedServiceCount,
    cartTotalPaise: req.query.cartTotalPaise || req.body?.cartTotalPaise,
    servicePricePaise: req.query.servicePricePaise || req.body?.servicePricePaise,
    baseDiscountPercent: req.query.baseDiscountPercent || req.body?.baseDiscountPercent,
    bundleMarginPercent: req.query.bundleMarginPercent || req.body?.bundleMarginPercent,
    addOnAttachRatePercent: req.query.addOnAttachRatePercent || req.body?.addOnAttachRatePercent,
    targetTicketLiftPaise: req.query.targetTicketLiftPaise || req.body?.targetTicketLiftPaise,
    packageEligible: req.query.packageEligible || req.body?.packageEligible,
    packagePricePaise: req.query.packagePricePaise || req.body?.packagePricePaise
  };
}

function asBadRequest(error, fallback) {
  return badRequest(error.message || fallback);
}

happyHoursBundleAwareRouter.get(
  "/evaluate",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursBundleAwareRepo.evaluate(input(req)));
    } catch (error) {
      throw asBadRequest(error, "Unable to evaluate bundle-aware offers");
    }
  })
);

happyHoursBundleAwareRouter.get(
  "/suggestions",
  asyncHandler((req, res) => {
    res.json(happyHoursBundleAwareRepo.listSuggestions({
      ...scope(req),
      status: req.query.status,
      limit: req.query.limit
    }));
  })
);

happyHoursBundleAwareRouter.post(
  "/suggestions",
  asyncHandler((req, res) => {
    try {
      res.status(201).json({ suggestion: happyHoursBundleAwareRepo.saveSuggestion(input(req)) });
    } catch (error) {
      throw asBadRequest(error, "Unable to save bundle-aware suggestion");
    }
  })
);

happyHoursBundleAwareRouter.patch(
  "/suggestions/:id/status",
  asyncHandler((req, res) => {
    try {
      res.json({
        suggestion: happyHoursBundleAwareRepo.updateStatus({
          ...scope(req),
          id: req.params.id,
          status: req.body?.status
        })
      });
    } catch (error) {
      throw asBadRequest(error, "Unable to update bundle-aware suggestion");
    }
  })
);
