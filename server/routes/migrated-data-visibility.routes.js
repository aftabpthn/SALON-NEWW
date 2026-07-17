import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { migratedDataVisibilityService } from "../services/migrated-data-visibility.service.js";

export const migratedDataVisibilityRouter = Router();

migratedDataVisibilityRouter.get("/visibility/services", requirePermission("read", () => "services"), asyncHandler((req, res) => res.json(migratedDataVisibilityService.services(req.query, req.access))));
migratedDataVisibilityRouter.get("/visibility/clients/:id/related", requirePermission("read", () => "clients"), asyncHandler((req, res) => res.json(migratedDataVisibilityService.clientRelated(req.params.id, req.query, req.access))));
migratedDataVisibilityRouter.get("/customer-360/clients/:id/service-history", requirePermission("read", () => "clients"), asyncHandler((req, res) => res.json(migratedDataVisibilityService.clientServiceHistory(req.params.id, req.query, req.access))));
migratedDataVisibilityRouter.get("/visibility/products/:id/movements", requirePermission("read", () => "products"), asyncHandler((req, res) => res.json(migratedDataVisibilityService.productMovements(req.params.id, req.query, req.access))));
migratedDataVisibilityRouter.get("/visibility/membership-client-labels", requirePermission("read", () => "memberships"), asyncHandler((req, res) => res.json(migratedDataVisibilityService.membershipClientLabels(req.query, req.access))));
migratedDataVisibilityRouter.get("/visibility/gift-cards/:id", requirePermission("read", () => "payments"), asyncHandler((req, res) => res.json(migratedDataVisibilityService.giftCard(req.params.id, req.query, req.access))));
migratedDataVisibilityRouter.get("/migration/large-jobs/:id/staging-rows", requirePermission("read", () => "migration"), asyncHandler((req, res) => res.json(migratedDataVisibilityService.stagingRows(req.params.id, req.query, req.access))));
