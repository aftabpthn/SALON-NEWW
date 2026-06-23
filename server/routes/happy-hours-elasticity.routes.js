import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursElasticityRepo } from "../repositories/happy-hours-elasticity.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursElasticityRouter = Router();

function scope(req) {
  const tenantId = req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || req.body?.tenantId || "";
  const branchId = req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || req.body?.branchId || "";
  if (!tenantId || !branchId) throw badRequest("tenantId and branchId are required");
  return { tenantId, branchId };
}

function queryScope(req) {
  return {
    ...scope(req),
    dayOfWeek: req.query.dayOfWeek,
    hourSlot: req.query.hourSlot,
    from: req.query.from,
    to: req.query.to,
    serviceCategory: req.query.serviceCategory,
    servicePricePaise: req.query.servicePricePaise,
    discountPct: req.query.discountPct,
    quantity: req.query.quantity
  };
}

happyHoursElasticityRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    res.json(happyHoursElasticityRepo.elasticitySummary(queryScope(req)));
  })
);

happyHoursElasticityRouter.get(
  "/recommend",
  asyncHandler((req, res) => {
    res.json(happyHoursElasticityRepo.profitAwareRecommendation(queryScope(req)));
  })
);

happyHoursElasticityRouter.get(
  "/profit-preview",
  asyncHandler((req, res) => {
    res.json(happyHoursElasticityRepo.profitPreview(queryScope(req)));
  })
);

happyHoursElasticityRouter.get(
  "/assumptions",
  asyncHandler((req, res) => {
    res.json({ rows: happyHoursElasticityRepo.listAssumptions(scope(req)) });
  })
);

happyHoursElasticityRouter.post(
  "/assumptions",
  asyncHandler((req, res) => {
    try {
      const assumption = happyHoursElasticityRepo.setAssumption({ ...scope(req), ...req.body });
      res.status(201).json({ assumption });
    } catch (error) {
      throw badRequest(error.message || "Unable to save profit assumptions");
    }
  })
);
