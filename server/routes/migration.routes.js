import express, { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { migrationService } from "../services/migration.service.js";
import { largeFileUploadService } from "../services/large-file-upload.service.js";
import { badRequest } from "../utils/app-error.js";

const LARGE_UPLOAD_ACCEPTED_TYPES = new Set([
  "text/csv", "application/csv",
  "application/zip", "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream"
]);

function assertLargeUploadContentType(req, _res, next) {
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (!LARGE_UPLOAD_ACCEPTED_TYPES.has(ct)) {
    return next(badRequest(`Unsupported content type "${ct}". Accepted types: CSV, Excel, ZIP.`));
  }
  next();
}

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
  "/migration/normalize-source",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.normalizeSource(req.body, req.access));
  })
);
migrationRouter.post(
  "/migration/uploads",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.uploadSource(req.body, req.access));
  })
);
migrationRouter.post(
  "/migration/uploads/binary",
  requirePermission("write", migrationResource),
  express.raw({ type: "*/*", limit: process.env.MIGRATION_UPLOAD_RAW_LIMIT || "180mb" }),
  asyncHandler((req, res) => {
    const fileName = req.query.fileName || req.headers["x-file-name"] || req.headers["x-migration-file-name"] || "migration-source.zip";
    res.status(201).json(migrationService.uploadSourceBuffer({
      fileName,
      mimeType: req.headers["content-type"] || "application/octet-stream",
      purpose: req.query.purpose || req.headers["x-migration-purpose"] || "source",
      buffer: req.body
    }, req.access));
  })
);


migrationRouter.get(
  "/migration/uploads/sessions",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.uploadSessions(req.query || {}, req.access));
  })
);

migrationRouter.get(
  "/migration/uploads/sessions/:id",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.uploadSession(req.params.id, req.access));
  })
);
migrationRouter.post(
  "/migration/uploads/sessions",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.createUploadSession(req.body || {}, req.access));
  })
);

migrationRouter.post(
  "/migration/uploads/sessions/:id/parts/:partNumber",
  requirePermission("write", migrationResource),
  express.raw({ type: "*/*", limit: process.env.MIGRATION_UPLOAD_PART_LIMIT || "16mb" }),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.uploadSessionPart(req.params.id, req.params.partNumber, { buffer: req.body }, req.access));
  })
);

migrationRouter.post(
  "/migration/uploads/sessions/:id/complete",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.completeUploadSession(req.params.id, req.body || {}, req.access));
  })
);
migrationRouter.post(
  "/migration/command-center",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.commandCenter(req.body || {}, req.access));
  })
);

migrationRouter.post(
  "/migration/proof-pack",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.proofPack(req.body || {}, req.access));
  })
);
migrationRouter.post(
  "/migration/reconcile",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.reconcile(req.body, req.access));
  })
);

migrationRouter.post(
  "/migration/large-jobs/worker/tick",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.processQueuedLargeJobs(req.body || {}, req.access));
  })
);

migrationRouter.post(
  "/migration/large-jobs",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.createLargeJob(req.body, req.access));
  })
);




migrationRouter.post(
  "/migration/large-jobs/:id/pause",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.pauseLargeJob(req.params.id, req.body || {}, req.access));
  })
);

migrationRouter.post(
  "/migration/large-jobs/:id/cancel",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.cancelLargeJob(req.params.id, req.body || {}, req.access));
  })
);

migrationRouter.post(
  "/migration/large-jobs/:id/discard",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.discardLargeJob(req.params.id, req.access));
  })
);

migrationRouter.post(
  "/migration/large-jobs/:id/retry-failed",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.retryFailedLargeJobChunks(req.params.id, req.body || {}, req.access));
  })
);

migrationRouter.post(
  "/migration/large-upload",
  requirePermission("write", migrationResource),
  express.raw({ type: "*/*", limit: process.env.MIGRATION_LARGE_UPLOAD_RAW_LIMIT || "500mb" }),
  assertLargeUploadContentType,
  asyncHandler(async (req, res) => {
    res.status(201).json(await largeFileUploadService.handleUpload(req.body, req.headers, req.access));
  })
);

migrationRouter.post(
  "/migration/large-upload/from-file-ref",
  requirePermission("write", migrationResource),
  asyncHandler(async (req, res) => {
    res.status(201).json(await largeFileUploadService.handleStoredUpload(req.body || {}, req.access));
  })
);
migrationRouter.post(
  "/migration/large-jobs/:id/queue",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.queueLargeJob(req.params.id, req.body || {}, req.access));
  })
);

migrationRouter.post(
  "/migration/large-jobs/:id/start",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.startLargeJob(req.params.id, req.body || {}, req.access));
  })
);

migrationRouter.post(
  "/migration/large-jobs/:id/resume",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.resumeLargeJob(req.params.id, req.body || {}, req.access));
  })
);

migrationRouter.get(
  "/migration/large-jobs/:id",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    const job = migrationService.largeJob(req.params.id, req.access);
    if (!job) {
      res.status(404).json({ message: "Large migration job not found" });
      return;
    }
    res.json(job);
  })
);


migrationRouter.post(
  "/migration/large-jobs/:id/reconcile",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.reconcileLargeJob(req.params.id, req.body || {}, req.access));
  })
);
migrationRouter.post(
  "/migration/large-jobs/:id/chunks",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.registerLargeJobChunk(req.params.id, req.body, req.access));
  })
);

migrationRouter.post(
  "/migration/large-jobs/:id/chunks/:chunkNumber/stage-csv",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.stageLargeJobCsvChunk(req.params.id, req.params.chunkNumber, req.body || {}, req.access));
  })
);migrationRouter.post(
  "/migration/large-jobs/:id/chunks/:chunkNumber/analyze",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.analyzeLargeJobChunk(req.params.id, req.params.chunkNumber, req.body, req.access));
  })
);
migrationRouter.post(
  "/migration/large-jobs/:id/chunks/:chunkNumber/import",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.importLargeJobChunk(req.params.id, req.params.chunkNumber, req.body, req.access));
  })
);
migrationRouter.post(
  "/migration/large-jobs/:id/chunks/:chunkNumber/import-staged",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    res.status(201).json(migrationService.importLargeJobStagedChunk(req.params.id, req.params.chunkNumber, req.body || {}, req.access));
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
migrationRouter.get(
  "/migration/jobs/:id/recovery",
  requirePermission("read", migrationResource),
  asyncHandler((req, res) => {
    res.json(migrationService.jobRecovery(req.params.id, req.access));
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
  "/migration/error-report.xlsx",
  requirePermission("write", migrationResource),
  asyncHandler((req, res) => {
    const report = migrationService.errorReportWorkbook(req.body || {}, req.access);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${report.fileName}"`);
    res.setHeader("X-Migration-Error-Rows", String(report.rowCount || 0));
    res.status(200).send(report.buffer);
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





