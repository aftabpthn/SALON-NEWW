import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireIdempotencyKey } from "../middleware/idempotency.middleware.js";
import { requireStaffAppSelfOrPermission } from "../middleware/rbac.js";
import { staffSelfContext } from "../middleware/staff-self-context.middleware.js";
import { teamChatService } from "../services/team-chat.service.js";

export const teamChatRouter = Router();

teamChatRouter.get(
  "/team-chat/conversations",
  staffSelfContext(),
  requireStaffAppSelfOrPermission("read", "staff-app-appointments"),
  asyncHandler((req, res) => res.json(teamChatService.listConversations(req.access)))
);

teamChatRouter.post(
  "/team-chat/private-owner",
  requireIdempotencyKey,
  staffSelfContext([]),
  requireStaffAppSelfOrPermission("write", "staff-app-appointments"),
  asyncHandler((req, res) => res.json(teamChatService.getOrCreatePrivateOwner(req.access)))
);

teamChatRouter.get(
  "/team-chat/conversations/:conversationId/messages",
  staffSelfContext(),
  requireStaffAppSelfOrPermission("read", "staff-app-appointments"),
  asyncHandler((req, res) => res.json(teamChatService.listMessages(req.params.conversationId, req.access)))
);

teamChatRouter.post(
  "/team-chat/conversations/:conversationId/messages",
  requireIdempotencyKey,
  staffSelfContext(["body", "message"]),
  requireStaffAppSelfOrPermission("write", "staff-app-appointments"),
  asyncHandler((req, res) => res.status(201).json(teamChatService.sendMessage(req.params.conversationId, req.body, req.access)))
);

teamChatRouter.post(
  "/team-chat/conversations/:conversationId/receipts",
  staffSelfContext(["status", "messageIds"]),
  requireStaffAppSelfOrPermission("read", "staff-app-appointments"),
  asyncHandler((req, res) => res.json(teamChatService.markReceipts(req.params.conversationId, req.body, req.access)))
);
