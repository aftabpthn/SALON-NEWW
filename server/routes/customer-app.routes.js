import { Router } from "express";
import { authenticateJwt } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { customerAppService } from "../services/customer-app.service.js";
import { customerNotificationService } from "../services/customer-notification.service.js";

export const customerAppRouter = Router();

customerAppRouter.use("/customer", authenticateJwt());

customerAppRouter.get("/customer/bookings", asyncHandler((req, res) => {
  res.json(customerAppService.bookings(req.access, req.query.status || ""));
}));

customerAppRouter.post("/customer/bookings", asyncHandler((req, res) => {
  res.status(201).json(customerAppService.createBooking(req.access, req.body || {}));
}));

customerAppRouter.get("/customer/bookings/:id", asyncHandler((req, res) => {
  res.json(customerAppService.booking(req.access, req.params.id));
}));

customerAppRouter.post("/customer/bookings/:id/cancel", asyncHandler((req, res) => {
  res.json(customerAppService.cancelBooking(req.access, req.params.id, req.body || {}));
}));

customerAppRouter.post("/customer/bookings/:id/reschedule", asyncHandler((req, res) => {
  res.json(customerAppService.rescheduleBooking(req.access, req.params.id, req.body || {}));
}));

customerAppRouter.post("/customer/bookings/:id/waitlist", asyncHandler((req, res) => {
  res.status(201).json(customerAppService.waitlist(req.access, req.params.id, req.body || {}));
}));

customerAppRouter.post("/customer/bookings/:id/review", asyncHandler((req, res) => {
  res.status(201).json(customerAppService.reviewBooking(req.access, req.params.id, req.body || {}));
}));

customerAppRouter.get("/customer/favorites", asyncHandler((req, res) => {
  res.json(customerAppService.listFavorites(req.access));
}));

customerAppRouter.post("/customer/favorites/:businessId", asyncHandler((req, res) => {
  res.status(201).json(customerAppService.addFavorite(req.access, req.params.businessId));
}));

customerAppRouter.delete("/customer/favorites/:businessId", asyncHandler((req, res) => {
  customerAppService.removeFavorite(req.access, req.params.businessId);
  res.json({ removed: true });
}));

customerAppRouter.get("/customer/saved-salons", asyncHandler((req, res) => {
  res.json(customerAppService.listSavedSalons(req.access));
}));

customerAppRouter.post("/customer/saved-salons/:businessId", asyncHandler((req, res) => {
  res.status(201).json(customerAppService.saveSalon(req.access, req.params.businessId));
}));

customerAppRouter.delete("/customer/saved-salons/:businessId", asyncHandler((req, res) => {
  customerAppService.removeSavedSalon(req.access, req.params.businessId);
  res.json({ removed: true });
}));

customerAppRouter.get("/customer/rewards", asyncHandler((req, res) => {
  res.json(customerAppService.rewards(req.access));
}));

customerAppRouter.get("/customer/wallet", asyncHandler((req, res) => {
  res.json(customerAppService.wallet(req.access));
}));

customerAppRouter.get("/customer/memberships", asyncHandler((req, res) => {
  res.json(customerAppService.memberships(req.access));
}));

customerAppRouter.post("/customer/memberships", asyncHandler((req, res) => {
  res.status(201).json(customerAppService.buyMembership(req.access, req.body?.planId || "", req.body?.branchId || ""));
}));

customerAppRouter.get("/customer/packages", asyncHandler((req, res) => {
  res.json(customerAppService.packages(req.access));
}));

customerAppRouter.get("/customer/gift-cards", asyncHandler((req, res) => {
  res.json(customerAppService.giftCards(req.access));
}));

customerAppRouter.post("/customer/gift-cards", asyncHandler((req, res) => {
  res.status(201).json(customerAppService.purchaseGiftCard(req.access, req.body || {}));
}));

customerAppRouter.post("/customer/gift-cards/redeem", asyncHandler((req, res) => {
  res.json(customerAppService.redeemGiftCard(req.access, req.body || {}));
}));

customerAppRouter.get("/customer/invoices", asyncHandler((req, res) => {
  res.json(customerAppService.invoices(req.access));
}));

customerAppRouter.post("/customer/invoices/:invoiceId/payment-link", asyncHandler((req, res) => {
  res.status(201).json(customerAppService.paymentLink(req.access, req.params.invoiceId, req.body?.amountPaise));
}));

customerAppRouter.get("/customer/payments", asyncHandler((req, res) => {
  res.json(customerAppService.payments(req.access));
}));

customerAppRouter.get("/customer/notifications", asyncHandler((req, res) => {
  res.json(customerNotificationService.list(req.access, req.query || {}));
}));

customerAppRouter.patch("/customer/notifications/read-all", asyncHandler((req, res) => {
  res.json(customerNotificationService.markAllRead(req.access));
}));

customerAppRouter.patch("/customer/notifications/:id", asyncHandler((req, res) => {
  res.json(customerNotificationService.markRead(req.access, req.params.id, req.body?.status || "read"));
}));

customerAppRouter.get("/customer/notification-preferences", asyncHandler((req, res) => {
  res.json(customerNotificationService.preferences(req.access));
}));

customerAppRouter.patch("/customer/notification-preferences", asyncHandler((req, res) => {
  res.json(customerNotificationService.updatePreferences(req.access, req.body || {}));
}));

customerAppRouter.put("/customer/push-devices/:deviceId", asyncHandler((req, res) => {
  res.json(customerNotificationService.registerDevice(req.access, { ...req.body, deviceId: req.params.deviceId }));
}));

customerAppRouter.delete("/customer/push-devices/:deviceId", asyncHandler((req, res) => {
  res.json(customerNotificationService.unregisterDevice(req.access, req.params.deviceId));
}));

customerAppRouter.get("/customer/devices", asyncHandler((req, res) => {
  res.json(customerAppService.devices(req.access));
}));

customerAppRouter.delete("/customer/devices/:sessionId", asyncHandler((req, res) => {
  customerAppService.logoutDevice(req.access, req.params.sessionId);
  res.json({ revoked: true });
}));

customerAppRouter.delete("/customer/devices", asyncHandler((req, res) => {
  customerAppService.logoutAllDevices(req.access);
  res.json({ revoked: true });
}));

customerAppRouter.delete("/customer/me", asyncHandler((req, res) => {
  res.json(customerAppService.deleteMe(req.access));
}));
