import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursClientReturnTrackerRepo } from "../repositories/happy-hours-client-return-tracker.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursClientReturnTrackerRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || "",
    from: req.query?.from || "",
    to: req.query?.to || "",
    status: req.query?.status || "",
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
  return badRequest(error.message || "Invalid Client Return Tracker request");
}

happyHoursClientReturnTrackerRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursClientReturnTrackerRepo.summary(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursClientReturnTrackerRouter.get(
  "/clients",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursClientReturnTrackerRepo.clients(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursClientReturnTrackerRouter.get(
  "/offers",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursClientReturnTrackerRepo.offers(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
