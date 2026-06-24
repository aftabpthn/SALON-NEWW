import { Router } from "express";
import { requirePermission } from "../middleware/rbac.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { invoiceNotificationService } from "../services/invoice-notification.service.js";

export const invoiceNotificationRouter = Router();

invoiceNotificationRouter.get(
  "/invoice-notifications/profile",
  requirePermission("read", () => "settings"),
  asyncHandler((req, res) => {
    res.json(invoiceNotificationService.getProfile(req.query, req.access));
  })
);

invoiceNotificationRouter.put(
  "/invoice-notifications/profile",
  requirePermission("write", () => "settings"),
  asyncHandler((req, res) => {
    res.json(invoiceNotificationService.saveProfile(req.body, req.access));
  })
);

invoiceNotificationRouter.post(
  "/invoice-notifications/profile/media",
  requirePermission("write", () => "settings"),
  asyncHandler((req, res) => {
    const publicBaseUrl = `${req.protocol}://${req.get("host")}`;
    res.status(201).json(invoiceNotificationService.uploadProfileMedia(req.body, req.access, { publicBaseUrl }));
  })
);

invoiceNotificationRouter.get(
  "/invoice-notifications/queue",
  requirePermission("read", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(invoiceNotificationService.listQueue(req.query, req.access));
  })
);

invoiceNotificationRouter.post(
  "/invoice-notifications/invoices/:invoiceId/queue",
  requirePermission("write", () => "notifications"),
  asyncHandler((req, res) => {
    res.status(201).json(invoiceNotificationService.queueExistingInvoice(req.params.invoiceId, req.access));
  })
);

invoiceNotificationRouter.post(
  "/invoice-notifications/:id/mark-sent",
  requirePermission("write", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(invoiceNotificationService.markSent(req.params.id, req.body, req.access));
  })
);

invoiceNotificationRouter.post(
  "/invoice-notifications/:id/mark-failed",
  requirePermission("write", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(invoiceNotificationService.markFailed(req.params.id, req.body, req.access));
  })
);
