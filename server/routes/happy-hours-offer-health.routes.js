import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursOfferHealthRepo } from "../repositories/happy-hours-offer-health.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursOfferHealthRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || "",
    from: req.query?.from || "",
    to: req.query?.to || "",
    healthStatus: req.query?.healthStatus || "",
    offerType: req.query?.offerType || "",
    returnWindowDays: req.query?.returnWindowDays || "",
    limit: req.query?.limit,
    offset: req.query?.offset
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid Offer Health Score request");
}

happyHoursOfferHealthRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursOfferHealthRepo.summary(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursOfferHealthRouter.get(
  "/offers",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursOfferHealthRepo.list(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
