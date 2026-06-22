import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { level6ReadinessRepo } from "../repositories/level6-readiness.repo.js";
import { badRequest } from "../utils/app-error.js";

export const level6ReadinessRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

level6ReadinessRouter.get(
  "/level6-readiness",
  asyncHandler((req, res) => {
    try {
      res.json(level6ReadinessRepo.getLevel6Readiness(requireScope(req)));
    } catch (error) {
      throw badRequest(error.message || "Unable to build Level 6 readiness report");
    }
  })
);
