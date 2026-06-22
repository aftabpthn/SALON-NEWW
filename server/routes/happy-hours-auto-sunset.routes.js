import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursAutoSunsetRepo } from "../repositories/happy-hours-auto-sunset.repo.js";
import { badRequest, notFound } from "../utils/app-error.js";

export const happyHoursAutoSunsetRouter = Router();

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
  return badRequest(error.message || "Invalid Offer Auto-Sunset request");
}

happyHoursAutoSunsetRouter.get(
  "/policy",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursAutoSunsetRepo.getPolicy(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursAutoSunsetRouter.post(
  "/policy",
  asyncHandler((req, res) => {
    try {
      const current = requireScope(req);
      res.json(happyHoursAutoSunsetRepo.savePolicy({
        ...req.body,
        ...current,
        createdBy: req.body?.createdBy || current.userId || null
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursAutoSunsetRouter.get(
  "/decisions",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursAutoSunsetRepo.listDecisions({
        ...requireScope(req),
        status: req.query.status,
        severity: req.query.severity,
        limit: req.query.limit,
        offset: req.query.offset
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursAutoSunsetRouter.post(
  "/scan",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursAutoSunsetRepo.runAutoSunset({
        ...requireScope(req),
        apply: req.body?.apply === true,
        source: "manual",
        currentDate: req.body?.currentDate || req.query?.currentDate
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursAutoSunsetRouter.post(
  "/decisions/:id/apply",
  asyncHandler((req, res) => {
    try {
      const row = happyHoursAutoSunsetRepo.applyDecision({ ...requireScope(req), id: req.params.id });
      if (!row) throw notFound("Auto-sunset decision not found");
      res.json(row);
    } catch (error) {
      if (error.statusCode === 404) throw error;
      throw asBadRequest(error);
    }
  })
);
