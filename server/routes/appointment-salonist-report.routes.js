import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { appointmentSalonistReportService } from "../services/appointment-salonist-report.service.js";

export const appointmentSalonistReportRouter = Router();

appointmentSalonistReportRouter.get(
  "/reports/appointment-detail-list",
  requirePermission("read", () => "reports"),
  asyncHandler((req, res) => {
    res.json(appointmentSalonistReportService.detail(req.query, req.access));
  })
);

appointmentSalonistReportRouter.get(
  "/reports/staff-appointments",
  requirePermission("read", () => "reports"),
  asyncHandler((req, res) => {
    res.json(appointmentSalonistReportService.staffAppointments(req.query, req.access));
  })
);
