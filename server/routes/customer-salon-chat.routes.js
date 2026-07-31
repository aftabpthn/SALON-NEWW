import { Router } from "express";
import { authenticateJwt } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { customerSalonChatService as service } from "../services/customer-salon-chat.service.js";
import { forbidden } from "../utils/app-error.js";

export const customerSalonChatRouter = Router();

customerSalonChatRouter.use(["/customer", "/salon-chat"], authenticateJwt());

function customerOnly(req, _res, next) {
  if (req.access?.role !== "customer") return next(forbidden("Customer access required"));
  next();
}

function staffOnly(req, _res, next) {
  if (req.access?.role === "customer") return next(forbidden("Staff access required"));
  next();
}

customerSalonChatRouter.post("/customer/bookings/:bookingId/chat", customerOnly, asyncHandler((req, res) => {
  res.json(service.getOrCreateCustomerConversation(req.access, req.params.bookingId, req.body || {}));
}));

customerSalonChatRouter.get("/customer/salon-chat/conversations/:conversationId/messages", customerOnly, asyncHandler((req, res) => {
  res.json(service.getCustomerMessages(req.access, req.params.conversationId, req.query || {}));
}));

customerSalonChatRouter.post("/customer/salon-chat/conversations/:conversationId/messages", customerOnly, asyncHandler((req, res) => {
  res.status(201).json(service.sendCustomerMessage(req.access, req.params.conversationId, req.body || {}));
}));

customerSalonChatRouter.post("/customer/salon-chat/conversations/:conversationId/read", customerOnly, asyncHandler((req, res) => {
  res.json(service.markCustomerRead(req.access, req.params.conversationId, req.body || {}));
}));

customerSalonChatRouter.get("/salon-chat/conversations", staffOnly, requirePermission("read", () => "appointments"), asyncHandler((req, res) => {
  res.json(service.listStaffConversations(req.access, req.query || {}));
}));

customerSalonChatRouter.get("/salon-chat/conversations/:conversationId/messages", staffOnly, requirePermission("read", () => "appointments"), asyncHandler((req, res) => {
  res.json(service.getStaffMessages(req.access, req.params.conversationId, req.query || {}));
}));

customerSalonChatRouter.post("/salon-chat/conversations/:conversationId/messages", staffOnly, requirePermission("write", () => "appointments"), asyncHandler((req, res) => {
  res.status(201).json(service.sendStaffMessage(req.access, req.params.conversationId, req.body || {}));
}));

customerSalonChatRouter.post("/salon-chat/conversations/:conversationId/read", staffOnly, requirePermission("read", () => "appointments"), asyncHandler((req, res) => {
  res.json(service.markStaffRead(req.access, req.params.conversationId, req.body || {}));
}));

customerSalonChatRouter.patch("/salon-chat/conversations/:conversationId", staffOnly, requirePermission("write", () => "appointments"), asyncHandler((req, res) => {
  res.json(service.updateStaffConversation(req.access, req.params.conversationId, req.body || {}));
}));
