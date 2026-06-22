import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody } from "../validators/request-validator.js";
import { slotReservationService } from "../services/slot-reservation.service.js";

export const slotReservationRouter = Router();

slotReservationRouter.post(
  "/slot-holds",
  requirePermission("write", () => "appointments"),
  validateBody({ required: ["startTime", "endTime"] }),
  asyncHandler((req, res) => {
    res.status(201).json(slotReservationService.createHold(req.body, req.access));
  })
);

slotReservationRouter.patch(
  "/slot-holds/:id/extend",
  requirePermission("write", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(slotReservationService.extendHold(req.params.id, req.body?.extraMinutes || 10, req.access));
  })
);

slotReservationRouter.post(
  "/slot-holds/:id/convert",
  requirePermission("write", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(slotReservationService.convertToBooking(req.params.id, req.body?.appointmentId || "", req.access));
  })
);

slotReservationRouter.delete(
  "/slot-holds/:id",
  requirePermission("write", () => "appointments"),
  asyncHandler((req, res) => {
    res.json(slotReservationService.releaseHold(req.params.id, req.access));
  })
);
