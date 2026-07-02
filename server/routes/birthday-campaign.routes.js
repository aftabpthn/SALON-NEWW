import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { birthdayCampaignService } from "../services/birthday-campaign.service.js";

export const birthdayCampaignRouter = Router();

birthdayCampaignRouter.get(
  "/birthday-campaign/summary",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => {
    res.json(birthdayCampaignService.summary(req.query, req.access));
  })
);

birthdayCampaignRouter.post(
  "/birthday-campaign/send",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => {
    res.status(201).json(birthdayCampaignService.send(req.body, req.access));
  })
);
birthdayCampaignRouter.post(
  "/birthday-campaign/send-bulk",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => {
    res.status(201).json(birthdayCampaignService.sendBulk(req.body, req.access));
  })
);
