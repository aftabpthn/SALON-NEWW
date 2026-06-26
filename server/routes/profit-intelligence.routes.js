import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
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
