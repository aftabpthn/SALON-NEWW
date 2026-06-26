import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { profitActionQueueService } from "../services/profit-action-queue.service.js";
import { profitAwareBookingService } from "../services/profit-aware-booking.service.js";
import { profitIntelligenceService } from "../services/profit-intelligence.service.js";

export const profitIntelligenceRouter = Router();

profitIntelligenceRouter.get(
  "/profit-intelligence/summary",
  requirePermission("read", () => "finance"),
  asyncHandler((req, res) => {
    res.json(profitIntelligenceService.summary(req.query, req.access));
  })
);

profitIntelligenceRouter.get(
  "/profit-intelligence/breakdown",
  requirePermission("read", () => "finance"),
  asyncHandler((req, res) => {
    res.json(profitIntelligenceService.breakdown(req.query, req.access));
  })
);

profitIntelligenceRouter.get(
  "/profit-intelligence/booking-recommendations",
  requirePermission("read", () => "finance"),
  asyncHandler((req, res) => {
    res.json(profitAwareBookingService.recommendations(req.query, req.access));
  })
);

profitIntelligenceRouter.get(
  "/profit-intelligence/actions",
  requirePermission("read", () => "finance"),
  asyncHandler((req, res) => {
    res.json(profitActionQueueService.list(req.query, req.access));
  })
);

profitIntelligenceRouter.post(
  "/profit-intelligence/actions",
  requirePermission("write", () => "finance"),
  asyncHandler((req, res) => {
    res.status(201).json(profitActionQueueService.create(req.body, req.access));
  })
);

profitIntelligenceRouter.post(
  "/profit-intelligence/actions/:id/approve",
  requirePermission("write", () => "finance"),
  asyncHandler((req, res) => {
    res.json(profitActionQueueService.approve(req.params.id, req.access));
  })
);

profitIntelligenceRouter.post(
  "/profit-intelligence/actions/:id/complete",
  requirePermission("write", () => "finance"),
  asyncHandler((req, res) => {
    res.json(profitActionQueueService.complete(req.params.id, req.access));
  })
);

profitIntelligenceRouter.post(
  "/profit-intelligence/actions/:id/dismiss",
  requirePermission("write", () => "finance"),
  asyncHandler((req, res) => {
    res.json(profitActionQueueService.dismiss(req.params.id, req.access));
  })
);
