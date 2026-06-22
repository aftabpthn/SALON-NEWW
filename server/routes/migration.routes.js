import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { migrationService } from "../services/migration.service.js";

export const migrationRouter = Router();
const migrationResource = () => "migration";

migrationRouter.get(
  "/migration/adapters",
  requirePermission("read", migrationResource),
  asyncHandler((_req, res) => {
    res.json(migrationService.adapters());
  })
);

migrationRouter.get(
  "/migration/templates",
  requirePermission("read", migrationResource),
  asyncHandler((_req, res) => {
    res.json(migrationService.templates());
  })
);

migrationRouter.get(
  "/migration/templates/:resource",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.templates(req.params.resource));
  })
);

migrationRouter.get(
  "/migration/mappings",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.mappings(req.access));
  })
);

migrationRouter.post(
  "/migration/mappings",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.saveMapping(req.body, req.access));
  })
);

migrationRouter.post(
  "/migration/suggest-mapping",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.suggestMapping(req.body, req.access));
  })
);

migrationRouter.post(
  "/migration/reconcile",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.reconcile(req.body, req.access));
  })
);

migrationRouter.get(
  "/migration/approvals",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.approvals(req.query, req.access));
  })
);

migrationRouter.post(
  "/migration/approvals",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.submitApproval(req.body, req.access));
  })
);

// Frontend uses /decide. Keep this canonical endpoint.
migrationRouter.post(
  "/migration/approvals/:id/decide",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.decideApproval(req.params.id, req.body, req.access));
  })
);

// Backward-compatible alias in case older frontend calls /decision.
migrationRouter.post(
  "/migration/approvals/:id/decision",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.decideApproval(req.params.id, req.body, req.access));
  })
);

migrationRouter.get(
  "/migration/onboarding",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.onboarding(req.access));
  })
);

migrationRouter.get(
  "/migration/jobs",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.jobs(req.access));
  })
);

migrationRouter.get(
  "/migration/jobs/:id",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    const job = migrationService.job(req.params.id, req.access);
    if (!job) {
      res.status(404).json({ message: "Migration job not found" });
      return;
    }
    res.json(job);
  })
);

migrationRouter.post(
  "/migration/analyze",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.analyze(req.body, req.access));
  })
);

migrationRouter.post(
  "/migration/dry-run",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.dryRun(req.body, req.access));
  })
);

migrationRouter.post(
  "/migration/import",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.import(req.body, req.access));
  })
);

migrationRouter.post(
  "/migration/jobs/:id/rollback",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.rollback(req.params.id, req.access, req.body || {}));
  })
);

migrationRouter.post(
  "/migration/rollback",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.rollbackByFilter(req.access, req.body || {}));
  })
);

migrationRouter.post(
  "/migration/rollback/last",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.rollbackLast(req.access, req.body || {}));
  })
);
