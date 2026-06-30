import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { messageTemplateStudioService } from "../services/message-template-studio.service.js";

export const messageTemplateStudioRouter = Router();

messageTemplateStudioRouter.get(
  "/message-templates/preferences",
  requirePermission("read", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(messageTemplateStudioService.preferences(req.query, req.access));
  })
);

messageTemplateStudioRouter.put(
  "/message-templates/preferences",
  requirePermission("write", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(messageTemplateStudioService.updatePreferences(req.body, req.access));
  })
);

messageTemplateStudioRouter.post(
  "/message-templates/preview",
  requirePermission("read", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(messageTemplateStudioService.preview(req.body, req.access));
  })
);

messageTemplateStudioRouter.get(
  "/message-templates",
  requirePermission("read", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(messageTemplateStudioService.list(req.query, req.access));
  })
);

messageTemplateStudioRouter.post(
  "/message-templates",
  requirePermission("write", () => "notifications"),
  asyncHandler((req, res) => {
    res.status(201).json(messageTemplateStudioService.create(req.body, req.access));
  })
);

messageTemplateStudioRouter.put(
  "/message-templates/:id",
  requirePermission("write", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(messageTemplateStudioService.update(req.params.id, req.body, req.access));
  })
);

messageTemplateStudioRouter.post(
  "/message-templates/:id/test-send",
  requirePermission("write", () => "notifications"),
  asyncHandler((req, res) => {
    res.status(201).json(messageTemplateStudioService.testSend(req.params.id, req.body, req.access));
  })
);
