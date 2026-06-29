import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { locationSharingService } from "../services/location-sharing.service.js";

export const locationSharingRouter = Router();

locationSharingRouter.get(
  "/location-sharing/overview",
  requirePermission("read", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.overview(req.query, req.access));
  })
);

locationSharingRouter.patch(
  "/location-sharing/settings",
  requirePermission("write", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.updateSettings(req.body || {}, req.access));
  })
);

locationSharingRouter.put(
  "/location-sharing/rules",
  requirePermission("write", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.upsertRules(req.body || {}, req.access));
  })
);

locationSharingRouter.get(
  "/location-sharing/conflicts",
  requirePermission("read", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.conflicts(req.query, req.access));
  })
);

locationSharingRouter.post(
  "/location-sharing/conflicts/:id/resolve",
  requirePermission("write", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.resolveConflict(req.params.id, req.body || {}, req.access));
  })
);

locationSharingRouter.get(
  "/location-sharing/approvals",
  requirePermission("read", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.approvals(req.query, req.access));
  })
);

locationSharingRouter.post(
  "/location-sharing/approvals/:id/approve",
  requirePermission("write", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.decideApproval(req.params.id, "approved", req.body || {}, req.access));
  })
);

locationSharingRouter.post(
  "/location-sharing/approvals/:id/reject",
  requirePermission("write", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.decideApproval(req.params.id, "rejected", req.body || {}, req.access));
  })
);

locationSharingRouter.get(
  "/location-sharing/events",
  requirePermission("read", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.events(req.query, req.access));
  })
);

locationSharingRouter.get(
  "/location-sharing/reports",
  requirePermission("read", () => "branches"),
  asyncHandler((req, res) => {
    res.json(locationSharingService.reports(req.query, req.access));
  })
);
