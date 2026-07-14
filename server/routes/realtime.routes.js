import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { repositories } from "../repositories/repository-registry.js";
import { realtimeService } from "../services/realtime.service.js";
import { validateBody } from "../validators/request-validator.js";

export const realtimeRouter = Router();

realtimeRouter.post(
  "/realtime/ticket",
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.status(201).json(realtimeService.issueTicket(req.access, req.body || {}));
  })
);

realtimeRouter.get(
  "/realtime/queue",
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(realtimeService.listQueue(req.query, req.access));
  })
);

realtimeRouter.post(
  "/realtime/queue",
  requirePermission("write", () => "appointments"),
  validateBody({ required: ["branchId", "title"] }),
  asyncHandler((req, res) => {
    res.status(201).json(realtimeService.enqueue(req.body, req.access));
  })
);

realtimeRouter.patch(
  "/realtime/queue/:id",
  requirePermission("write", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(realtimeService.updateQueueItem(req.params.id, req.body, req.access));
  })
);

realtimeRouter.post(
  "/realtime/staff/status",
  validateBody({ required: ["status"] }),
  asyncHandler((req, res) => {
    const presence = realtimeService.updateStaffPresence(req.body, req.access);
    realtimeService.broadcast("staff.status", { presence }, {
      tenantId: req.access.tenantId,
      branchId: presence.branchId,
      channel: presence.branchId ? `branch:${presence.branchId}` : `tenant:${req.access.tenantId}`
    });
    res.json(presence);
  })
);

realtimeRouter.get(
  "/realtime/events",
  asyncHandler((req, res) => {
    res.json({
      connectedClients: realtimeService.clients.size,
      events: repositories.realtimeEvents.list(req.query, { tenantId: req.access.tenantId })
    });
  })
);
