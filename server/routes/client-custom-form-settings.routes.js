import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { clientCustomFormSettingsService } from "../services/client-custom-form-settings.service.js";

export const clientCustomFormSettingsRouter = Router();

clientCustomFormSettingsRouter.get(
  "/settings/clients/custom-form",
  requirePermission("read", () => "settings"),
  asyncHandler((req, res) => {
    res.json(clientCustomFormSettingsService.get(req.query, req.access));
  })
);

clientCustomFormSettingsRouter.put(
  "/settings/clients/custom-form",
  requirePermission("write", () => "settings"),
  asyncHandler((req, res) => {
    res.json(clientCustomFormSettingsService.save(req.body, req.access));
  })
);
