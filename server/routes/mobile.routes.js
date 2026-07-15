import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { pushNotificationService } from "../services/push-notification.service.js";
import { staffWebPushService } from "../services/staff-web-push.service.js";
import { validateBody } from "../validators/request-validator.js";

export const mobileRouter = Router();

mobileRouter.get("/mobile/push-config", asyncHandler((req, res) => {
  res.json(staffWebPushService.publicConfig());
}));

mobileRouter.get("/mobile/context", asyncHandler((req, res) => {
  res.json({
    user: req.user,
    tenant: req.tenant,
    access: req.access,
    websocket: {
      path: "/api/v1/realtime",
      auth: "Pass access token as ?token=ACCESS_TOKEN"
    }
  });
}));

mobileRouter.post(
  "/mobile/devices",
  validateBody({ required: ["platform"] }),
  asyncHandler((req, res) => {
    res.status(201).json(pushNotificationService.registerDevice(req.body, req.access));
  })
);

mobileRouter.post(
  "/mobile/push-subscriptions",
  validateBody({ required: ["deviceId", "endpoint"] }),
  asyncHandler((req, res) => {
    res.status(201).json(pushNotificationService.subscribe(req.body, req.access));
  })
);

mobileRouter.get(
  "/mobile/push-notifications",
  asyncHandler((req, res) => {
    res.json(pushNotificationService.listNotifications(req.query, req.access));
  })
);

mobileRouter.post(
  "/mobile/push-notifications",
  requirePermission("write", () => "notifications"),
  validateBody({ required: ["title", "message"] }),
  asyncHandler((req, res) => {
    res.status(201).json(pushNotificationService.send(req.body, req.access));
  })
);

mobileRouter.post(
  "/mobile/push-notifications/:id/sent",
  requirePermission("write", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(pushNotificationService.markSent(req.params.id, req.body.providerMessageId || "", req.access));
  })
);
