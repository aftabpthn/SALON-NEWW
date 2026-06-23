import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursStaffAwareRepo } from "../repositories/happy-hours-staff-aware.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursStaffAwareRouter = Router();

function scope(req) {
  const tenantId = req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || req.body?.tenantId || "";
  const branchId = req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || req.body?.branchId || "";
  if (!tenantId || !branchId) throw badRequest("tenantId and branchId are required");
  return { tenantId, branchId };
}

function input(req) {
  return {
    ...scope(req),
    staffId: req.query.staffId || req.body?.staffId,
    signalDate: req.query.signalDate || req.body?.signalDate,
    dayOfWeek: req.query.dayOfWeek || req.body?.dayOfWeek,
    hourSlot: req.query.hourSlot || req.body?.hourSlot,
    serviceCategory: req.query.serviceCategory || req.body?.serviceCategory,
    servicePricePaise: req.query.servicePricePaise || req.body?.servicePricePaise,
    capacityPerHour: req.query.capacityPerHour || req.body?.capacityPerHour
  };
}

function asBadRequest(error, fallback) {
  return badRequest(error.message || fallback);
}

happyHoursStaffAwareRouter.get(
  "/evaluate",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursStaffAwareRepo.evaluate(input(req)));
    } catch (error) {
      throw asBadRequest(error, "Unable to evaluate staff-aware offers");
    }
  })
);

happyHoursStaffAwareRouter.get(
  "/suggestions",
  asyncHandler((req, res) => {
    res.json(happyHoursStaffAwareRepo.listSuggestions({
      ...scope(req),
      status: req.query.status,
      limit: req.query.limit
    }));
  })
);

happyHoursStaffAwareRouter.post(
  "/suggestions",
  asyncHandler((req, res) => {
    try {
      res.status(201).json({ suggestion: happyHoursStaffAwareRepo.saveSuggestion(input(req)) });
    } catch (error) {
      throw asBadRequest(error, "Unable to save staff-aware suggestion");
    }
  })
);

happyHoursStaffAwareRouter.patch(
  "/suggestions/:id/status",
  asyncHandler((req, res) => {
    try {
      res.json({
        suggestion: happyHoursStaffAwareRepo.updateStatus({
          ...scope(req),
          id: req.params.id,
          status: req.body?.status
        })
      });
    } catch (error) {
      throw asBadRequest(error, "Unable to update staff-aware suggestion");
    }
  })
);
