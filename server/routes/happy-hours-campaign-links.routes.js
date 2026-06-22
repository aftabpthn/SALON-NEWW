import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursCampaignLinksRepo } from "../repositories/happy-hours-campaign-links.repo.js";
import { badRequest, notFound } from "../utils/app-error.js";

export const happyHoursCampaignLinksRouter = Router();

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

function withScope(req) {
  const current = requireScope(req);
  return {
    ...req.body,
    tenantId: current.tenantId,
    branchId: current.branchId,
    createdBy: req.body?.createdBy || current.userId || null
  };
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid campaign-to-rule request");
}

happyHoursCampaignLinksRouter.get(
  "/",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursCampaignLinksRepo.listCampaignLinks({
        ...requireScope(req),
        status: req.query.status,
        limit: req.query.limit,
        offset: req.query.offset
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursCampaignLinksRouter.post(
  "/preview",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursCampaignLinksRepo.previewCampaignFromRule(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursCampaignLinksRouter.post(
  "/from-rule",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursCampaignLinksRepo.createCampaignDraftFromRule(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursCampaignLinksRouter.patch(
  "/:id/status",
  asyncHandler((req, res) => {
    try {
      const row = happyHoursCampaignLinksRepo.updateCampaignStatus({
        ...withScope(req),
        id: req.params.id,
        status: req.body?.status
      });
      if (!row) throw notFound("Campaign link not found");
      res.json(row);
    } catch (error) {
      if (error.statusCode === 404) throw error;
      throw asBadRequest(error);
    }
  })
);
