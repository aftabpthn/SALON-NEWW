import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { incrementalityRepo } from "../repositories/incrementality.repo.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { shouldOffer } from "../utils/incrementality-gate.js";

export const pricingIncrementalityRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.body?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.body?.branchId || req.query?.branchId || "",
    userId: req.access?.userId || req.header("x-user-id") || "",
    role: req.header("x-user-role") || req.access?.role || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid incrementality request");
}

pricingIncrementalityRouter.get(
  "/incrementality-report",
  asyncHandler((req, res) => {
    try {
      res.json(incrementalityRepo.getIncrementalityReport({
        ...requireScope(req),
        offerType: req.query.offerType,
        from: req.query.from,
        to: req.query.to
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingIncrementalityRouter.post(
  "/incrementality/assign",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(incrementalityRepo.assignToGroup({
        ...req.body,
        ...requireScope(req)
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingIncrementalityRouter.post(
  "/incrementality/outcome",
  asyncHandler((req, res) => {
    try {
      const outcome = incrementalityRepo.recordExperimentOutcome({
        ...req.body,
        ...requireScope(req)
      });
      if (!outcome) throw notFound("Offer experiment not found");
      res.json(outcome);
    } catch (error) {
      if (error?.status === 404) throw error;
      throw asBadRequest(error);
    }
  })
);

pricingIncrementalityRouter.post(
  "/incrementality/should-offer",
  asyncHandler((req, res) => {
    try {
      res.json(shouldOffer({
        ...req.body,
        ...requireScope(req)
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingIncrementalityRouter.get(
  "/incrementality/uplift/:clientId",
  asyncHandler((req, res) => {
    try {
      const score = incrementalityRepo.getUpliftScore({
        ...requireScope(req),
        clientId: req.params.clientId
      });
      if (!score) throw notFound("Uplift score not found");
      res.json(score);
    } catch (error) {
      if (error?.status === 404) throw error;
      throw asBadRequest(error);
    }
  })
);

pricingIncrementalityRouter.post(
  "/incrementality/uplift-score",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(incrementalityRepo.upsertUpliftScore({
        ...req.body,
        ...requireScope(req)
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
