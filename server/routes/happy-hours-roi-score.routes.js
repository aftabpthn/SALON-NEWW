import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursRoiScoreRepo } from "../repositories/happy-hours-roi-score.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursRoiScoreRouter = Router();

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

function query(req) {
  return {
    ...requireScope(req),
    from: req.query.from,
    to: req.query.to,
    grade: req.query.grade,
    offerType: req.query.offerType,
    limit: req.query.limit,
    offset: req.query.offset
  };
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid Offer ROI Score request");
}

happyHoursRoiScoreRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursRoiScoreRepo.getOfferRoiSummary(query(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursRoiScoreRouter.get(
  "/offers",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursRoiScoreRepo.getOfferRoiScores(query(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursRoiScoreRouter.get(
  "/export.csv",
  asyncHandler((req, res) => {
    try {
      const rows = happyHoursRoiScoreRepo.getOfferRoiScores({ ...query(req), limit: 500, offset: 0 }).rows;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=happy-hours-offer-roi-score.csv");
      res.send(happyHoursRoiScoreRepo.rowsToCsv(rows));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
