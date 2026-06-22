import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { crossBranchAnalyticsRepo } from "../repositories/cross-branch-analytics.repo.js";
import { badRequest } from "../utils/app-error.js";

export const crossBranchAnalyticsRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.query?.scopeBranchId || req.query?.branchId || "",
    filterBranchId: req.query?.filterBranchId || "",
    regionId: req.query?.regionId || "",
    from: req.query?.from || "",
    to: req.query?.to || "",
    limit: req.query?.limit
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

crossBranchAnalyticsRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    res.json(crossBranchAnalyticsRepo.aggregateDiscountPerformance(requireScope(req)));
  })
);

crossBranchAnalyticsRouter.get(
  "/branches",
  asyncHandler((req, res) => {
    res.json(crossBranchAnalyticsRepo.branchComparison(requireScope(req)));
  })
);

crossBranchAnalyticsRouter.get(
  "/rules",
  asyncHandler((req, res) => {
    res.json(crossBranchAnalyticsRepo.topPerformingRules(requireScope(req)));
  })
);

crossBranchAnalyticsRouter.get(
  "/margin-impact",
  asyncHandler((req, res) => {
    res.json(crossBranchAnalyticsRepo.marginImpact(requireScope(req)));
  })
);
