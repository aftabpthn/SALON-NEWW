import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireIdempotencyKey } from "../middleware/idempotency.middleware.js";
import { requirePermission } from "../middleware/rbac.js";
import { ownerOperationsService } from "../services/owner-operations.service.js";
import { forbidden } from "../utils/app-error.js";

export const ownerOperationsRouter = Router();
ownerOperationsRouter.use("/owner-console/operations", (req, _res, next) => req.access?.role === "owner" ? next() : next(forbidden("Owner role is required")));

ownerOperationsRouter.get("/owner-console/operations/clients", requirePermission("read", () => "clients"), asyncHandler((req, res) => res.json(ownerOperationsService.clients(req.access, req.query))));
ownerOperationsRouter.get("/owner-console/operations/clients/:id", requirePermission("read", () => "clients"), asyncHandler((req, res) => res.json(ownerOperationsService.clientDetail(req.params.id, req.access, req.query))));
ownerOperationsRouter.get("/owner-console/operations/inventory", requirePermission("read", () => "products"), asyncHandler((req, res) => res.json(ownerOperationsService.inventory(req.access, req.query))));
ownerOperationsRouter.get("/owner-console/operations/inventory/:id", requirePermission("read", () => "inventory"), asyncHandler((req, res) => res.json(ownerOperationsService.inventoryDetail(req.params.id, req.access, req.query))));
ownerOperationsRouter.get("/owner-console/operations/marketing", requirePermission("read", () => "marketing"), asyncHandler((req, res) => res.json(ownerOperationsService.marketing(req.access, req.query))));
ownerOperationsRouter.get("/owner-console/operations/notifications", requirePermission("read", () => "notifications"), asyncHandler((req, res) => res.json(ownerOperationsService.notifications(req.access, req.query))));
ownerOperationsRouter.patch("/owner-console/operations/notifications/:id/receipt", requirePermission("write", () => "notifications"), asyncHandler((req, res) => res.json(ownerOperationsService.setNotificationRead(req.params.id, req.body?.read === true, req.access))));
ownerOperationsRouter.post("/owner-console/operations/notifications/mark-all-read", requirePermission("write", () => "notifications"), asyncHandler((req, res) => res.json(ownerOperationsService.markAllNotificationsRead(req.access, req.body || {}))));
ownerOperationsRouter.get("/owner-console/operations/chats", requirePermission("read", () => "appointments"), asyncHandler((req, res) => res.json(ownerOperationsService.chats(req.access, req.query))));
ownerOperationsRouter.post("/owner-console/operations/chats/private", requireIdempotencyKey, requirePermission("write", () => "appointments"), asyncHandler((req, res) => res.status(201).json(ownerOperationsService.createPrivateChat(req.body, req.access))));
ownerOperationsRouter.get("/owner-console/operations/chats/:id/messages", requirePermission("read", () => "appointments"), asyncHandler((req, res) => res.json(ownerOperationsService.chatMessages(req.params.id, req.access, req.query))));
ownerOperationsRouter.post("/owner-console/operations/chats/:id/messages", requireIdempotencyKey, requirePermission("write", () => "appointments"), asyncHandler((req, res) => res.status(201).json(ownerOperationsService.sendChatMessage(req.params.id, req.body, req.access))));
ownerOperationsRouter.post("/owner-console/operations/chats/:id/receipts", requirePermission("write", () => "appointments"), asyncHandler((req, res) => res.json(ownerOperationsService.markChatReceipts(req.params.id, req.body, req.access))));
