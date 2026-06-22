import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursFraudGuardRepo } from "../repositories/happy-hours-fraud-guard.repo.js";
import { badRequest, notFound } from "../utils/app-error.js";

export const happyHoursFraudGuardRouter = Router();

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
  return badRequest(error.message || "Invalid Happy Hours fraud guard request");
}

happyHoursFraudGuardRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursFraudGuardRepo.summary(requireScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursFraudGuardRouter.get(
  "/cases",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursFraudGuardRepo.listCases({
        ...requireScope(req),
        status: req.query.status,
        severity: req.query.severity,
        guardType: req.query.guardType,
        limit: req.query.limit,
        offset: req.query.offset
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursFraudGuardRouter.post(
  "/scan",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursFraudGuardRepo.scan({
        ...requireScope(req),
        from: req.body?.from || req.query?.from,
        to: req.body?.to || req.query?.to
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursFraudGuardRouter.patch(
  "/cases/:id/review",
  asyncHandler((req, res) => {
    try {
      const row = happyHoursFraudGuardRepo.reviewCase({
        ...requireScope(req),
        id: req.params.id,
        status: req.body?.status || "investigating",
        reviewedBy: req.body?.reviewedBy || scope(req).userId || null,
        reviewNote: req.body?.reviewNote || req.body?.note || ""
      });
      if (!row) throw notFound("Fraud guard case not found");
      res.json(row);
    } catch (error) {
      if (error.statusCode === 404) throw error;
      throw asBadRequest(error);
    }
  })
);

happyHoursFraudGuardRouter.post(
  "/assess",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursFraudGuardRepo.assessContext({
        ...req.body,
        ...requireScope(req)
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
