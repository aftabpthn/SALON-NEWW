import { Router } from "express";
import { authenticateJwt } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { createCustomerBookingSupportTicket, listCustomerBookingSupportTickets } from "../services/customer-booking-support.service.js";
import { forbidden } from "../utils/app-error.js";

export const customerBookingSupportRouter = Router();

customerBookingSupportRouter.use("/customer", authenticateJwt(), (req, _res, next) => {
  if (req.access?.role !== "customer") {
    next(forbidden("Customer access required"));
    return;
  }
  next();
});

customerBookingSupportRouter.post("/customer/bookings/:bookingId/support", asyncHandler((req, res) => {
  res.status(201).json(createCustomerBookingSupportTicket(req.access, req.params.bookingId, req.body || {}));
}));

customerBookingSupportRouter.get("/customer/support", asyncHandler((req, res) => {
  res.json(listCustomerBookingSupportTickets(req.access, req.query || {}));
}));
