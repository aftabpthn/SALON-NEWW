import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursBranchLeaderboardRepo } from "../repositories/happy-hours-branch-leaderboard.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursBranchLeaderboardRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.query?.scopeBranchId || req.query?.branchId || "",
    from: req.query?.from || "",
    to: req.query?.to || "",
    regionId: req.query?.regionId || "",
    sort: req.query?.sort || "score",
    limit: req.query?.limit
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid Branch Offer Leaderboard request");
}

happyHoursBranchLeaderboardRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursBranchLeaderboardRepo.summary(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursBranchLeaderboardRouter.get(
  "/",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursBranchLeaderboardRepo.leaderboard(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
