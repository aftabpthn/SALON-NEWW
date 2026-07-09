import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { authenticateJwt } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { leadManagementService } from "../services/lead-management.service.js";

export const leadManagementRouter = Router();

leadManagementRouter.use(authenticateJwt());

leadManagementRouter.get(
  "/leads/overview",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.overview(req.query, req.access)))
);

leadManagementRouter.get(
  "/leads/stages",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.stages(req.query, req.access)))
);

leadManagementRouter.post(
  "/leads/stages",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.saveStage(req.body || {}, req.access)))
);

leadManagementRouter.patch(
  "/leads/stages/:id",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.saveStage({ ...(req.body || {}), id: req.params.id }, req.access)))
);

leadManagementRouter.get(
  "/leads/types",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.types(req.query, req.access)))
);

leadManagementRouter.post(
  "/leads/types",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.saveType(req.body || {}, req.access)))
);

leadManagementRouter.patch(
  "/leads/types/:id",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.saveType({ ...(req.body || {}), id: req.params.id }, req.access)))
);

leadManagementRouter.get(
  "/leads/follow-ups",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.followUps(req.query, req.access)))
);

leadManagementRouter.get(
  "/leads/import/sample",
  requirePermission("read", () => "marketing"),
  asyncHandler((_req, res) => {
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=\"lead-import-sample.csv\"");
    res.send(leadManagementService.sampleCsv());
  })
);

leadManagementRouter.post(
  "/leads/import",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.importCsv(req.body || {}, req.access)))
);

leadManagementRouter.get(
  "/leads/reports",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.reports(req.query, req.access)))
);

leadManagementRouter.get(
  "/leads/automation/queue",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.automationQueue(req.query, req.access)))
);

leadManagementRouter.post(
  "/leads/automation/run",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.runAutomation(req.body || {}, req.access)))
);

leadManagementRouter.get(
  "/leads",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.list(req.query, req.access)))
);

leadManagementRouter.post(
  "/leads",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.create(req.body || {}, req.access)))
);

leadManagementRouter.get(
  "/leads/:id",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.detail(req.params.id, req.access)))
);

leadManagementRouter.patch(
  "/leads/:id",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.update(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.patch(
  "/leads/:id/stage",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.moveStage(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/assign",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.assignLead(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/escalate",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.escalateLead(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/win-back",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.createWinBack(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/client/link",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.linkClient(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/client/create",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.createClientFromLead(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/appointment/book",
  requirePermission("write", () => "appointments"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.bookAppointmentFromLead(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/invoice/link",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.linkInvoice(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/notes",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.addNote(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/follow-ups",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.addFollowUp(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/follow-ups/:followUpId/done",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.completeFollowUp(req.params.id, req.params.followUpId, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/call-log",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.callLog(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/email-log",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.emailLog(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/mark-won",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.markWon(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/mark-lost",
  requirePermission("write", () => "marketing"),
  asyncHandler((req, res) => res.json(leadManagementService.markLost(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/whatsapp/draft",
  requirePermission("write", () => "whatsapp"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.whatsappDraft(req.params.id, req.body || {}, req.access)))
);

leadManagementRouter.post(
  "/leads/:id/whatsapp/send",
  requirePermission("write", () => "whatsapp"),
  asyncHandler((req, res) => res.status(201).json(leadManagementService.whatsappSend(req.params.id, req.body || {}, req.access)))
);
