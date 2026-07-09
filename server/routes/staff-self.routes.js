import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { authenticateJwt } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { staffLoginService } from "../services/staff-login.service.js";

export const staffSelfRouter = Router();

staffSelfRouter.get(
  "/staff-self/dashboard",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.staffDashboard(req.query, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/enterprise-os",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.enterpriseOs(req.query, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/clients",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.clients(req.query, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/clients/:clientId/360",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.client360(req.params.clientId, req.query, req.access));
  })
);

staffSelfRouter.post(
  "/staff-self/clients/:clientId/media",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.status(201).json(staffLoginService.addClientMedia(req.params.clientId, req.body, req.access));
  })
);

staffSelfRouter.patch(
  "/staff-self/notifications/:id",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.updateStaffNotification(req.params.id, req.body, req.access));
  })
);

staffSelfRouter.patch(
  "/staff-self/appointments/:id",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.updateStaffAppointment(req.params.id, req.body, req.access));
  })
);

staffSelfRouter.patch(
  "/staff-self/calendar/:id",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.updateStaffCalendarItem(req.params.id, req.body, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/chat/threads",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.chatThreads(req.query, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/chat/threads/:threadId/messages",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.chatMessages(req.params.threadId, req.query, req.access));
  })
);

staffSelfRouter.post(
  "/staff-self/chat/messages",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.status(201).json(staffLoginService.sendChatMessage(req.body, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/learning",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.learning(req.query, req.access));
  })
);

staffSelfRouter.patch(
  "/staff-self/learning/:moduleId",
  authenticateJwt(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.completeLearningModule(req.params.moduleId, req.body, req.access));
  })
);
