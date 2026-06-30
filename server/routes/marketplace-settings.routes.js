import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { marketplaceSettingsService } from "../services/marketplace-settings.service.js";

export const marketplaceSettingsRouter = Router();

marketplaceSettingsRouter.get(
  "/settings/marketplace",
  requirePermission("read", () => "settings"),
  asyncHandler((req, res) => {
    res.json(marketplaceSettingsService.get(req.query, req.access));
  })
);

marketplaceSettingsRouter.put(
  "/settings/marketplace",
  requirePermission("write", () => "settings"),
  asyncHandler((req, res) => {
    res.json(marketplaceSettingsService.save(req.body, req.access));
  })
);
