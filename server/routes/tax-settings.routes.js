import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { taxSettingsService } from "../services/tax-settings.service.js";

export const taxSettingsRouter = Router();

taxSettingsRouter.get(
  "/settings/taxes",
  requirePermission("read", () => "settings"),
  asyncHandler((req, res) => {
    res.json(taxSettingsService.get(req.query, req.access));
  })
);

taxSettingsRouter.put(
  "/settings/taxes",
  requirePermission("write", () => "settings"),
  asyncHandler((req, res) => {
    res.json(taxSettingsService.save(req.body, req.access));
  })
);
