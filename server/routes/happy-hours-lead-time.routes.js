import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursLeadTimeRepo } from "../repositories/happy-hours-lead-time.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursLeadTimeRouter = Router();

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
    requestedStartAt: req.query.requestedStartAt || req.body?.requestedStartAt,
    bookingLeadMinutes: req.query.bookingLeadMinutes || req.body?.bookingLeadMinutes,
    servicePricePaise: req.query.servicePricePaise || req.body?.servicePricePaise,
    baseDiscountPercent: req.query.baseDiscountPercent || req.body?.baseDiscountPercent,
    lookbackDays: req.query.lookbackDays || req.body?.lookbackDays
  };
}

function asBadRequest(error, fallback) {
  return badRequest(error.message || fallback);
}

happyHoursLeadTimeRouter.get(
  "/evaluate",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursLeadTimeRepo.evaluate(input(req)));
    } catch (error) {
      throw asBadRequest(error, "Unable to evaluate lead-time offers");
    }
  })
);

happyHoursLeadTimeRouter.get(
  "/suggestions",
  asyncHandler((req, res) => {
    res.json(happyHoursLeadTimeRepo.listSuggestions({
      ...scope(req),
      status: req.query.status,
      limit: req.query.limit
    }));
  })
);

happyHoursLeadTimeRouter.post(
  "/suggestions",
  asyncHandler((req, res) => {
    try {
      res.status(201).json({ suggestion: happyHoursLeadTimeRepo.saveSuggestion(input(req)) });
    } catch (error) {
      throw asBadRequest(error, "Unable to save lead-time suggestion");
    }
  })
);

happyHoursLeadTimeRouter.patch(
  "/suggestions/:id/status",
  asyncHandler((req, res) => {
    try {
      res.json({
        suggestion: happyHoursLeadTimeRepo.updateStatus({
          ...scope(req),
          id: req.params.id,
          status: req.body?.status
        })
      });
    } catch (error) {
      throw asBadRequest(error, "Unable to update lead-time suggestion");
    }
  })
);
