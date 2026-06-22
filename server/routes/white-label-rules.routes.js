import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { whiteLabelRulesRepo } from "../repositories/white-label-rules.repo.js";
import { badRequest } from "../utils/app-error.js";

export const whiteLabelRulesRouter = Router();

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
  return badRequest(error.message || "Invalid white-label rule settings request");
}

whiteLabelRulesRouter.get(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    res.json({
      settings: whiteLabelRulesRepo.getSettings(current),
      publicLabels: whiteLabelRulesRepo.resolvePublicLabels(current)
    });
  })
);

whiteLabelRulesRouter.post(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      const settings = whiteLabelRulesRepo.saveSettings({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId,
        createdBy: req.body?.createdBy || current.userId || null
      });
      res.status(201).json({
        settings,
        publicLabels: whiteLabelRulesRepo.resolvePublicLabels(current)
      });
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
