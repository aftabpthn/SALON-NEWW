import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { authenticateJwt } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { staffLoginService } from "../services/staff-login.service.js";
import { generalSettingsService } from "../services/general-settings.service.js";
import { requireIdempotencyKey } from "../middleware/idempotency.middleware.js";
import { staffSelfContext } from "../middleware/staff-self-context.middleware.js";
import { staffSelfResponsePresenterService } from "../services/staff-self-response-presenter.service.js";

export const staffSelfRouter = Router();

staffSelfRouter.get(
  "/staff-self/workspace-preferences",
  authenticateJwt(),
  staffSelfContext(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(generalSettingsService.staffWorkspacePreferences(req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/dashboard",
  authenticateJwt(),
  staffSelfContext(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    const result = staffLoginService.staffDashboard(req.query, req.access);
    res.json(staffSelfResponsePresenterService.dashboard(result, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/enterprise-os",
  authenticateJwt(),
  staffSelfContext(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    const result = staffLoginService.enterpriseOs(req.query, req.access);
    res.json(staffSelfResponsePresenterService.enterprise(result, req.access));
  })
);

staffSelfRouter.patch(
  "/staff-self/notifications/:id",
  authenticateJwt(),
  staffSelfContext(["status"]),
  requirePermission("update", () => "notifications"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.updateStaffNotification(req.params.id, req.body, req.access));
  })
);

staffSelfRouter.patch(
  "/staff-self/calendar/:id",
  authenticateJwt(),
  staffSelfContext(["scheduleDate", "schedule_date", "date", "startTime", "start_time", "endTime", "end_time", "status", "notes", "version"]),
  requirePermission("update", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.updateStaffCalendarItem(req.params.id, req.body, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/chat/threads",
  authenticateJwt(),
  staffSelfContext(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.chatThreads(req.query, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/chat/threads/:threadId/messages",
  authenticateJwt(),
  staffSelfContext(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.chatMessages(req.params.threadId, req.query, req.access));
  })
);

staffSelfRouter.post(
  "/staff-self/chat/messages",
  authenticateJwt(),
  requireIdempotencyKey,
  staffSelfContext(["threadId", "thread_id", "body", "message"]),
  requirePermission("allow", () => "staff-message"),
  asyncHandler((req, res) => {
    res.status(201).json(staffLoginService.sendChatMessage(req.body, req.access));
  })
);

staffSelfRouter.get(
  "/staff-self/learning",
  authenticateJwt(),
  staffSelfContext(),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.learning(req.query, req.access));
  })
);

staffSelfRouter.patch(
  "/staff-self/learning/:moduleId",
  authenticateJwt(),
  staffSelfContext(["status"]),
  requirePermission("read", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(staffLoginService.completeLearningModule(req.params.moduleId, req.body, req.access));
  })
);
