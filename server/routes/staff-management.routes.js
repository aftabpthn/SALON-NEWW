import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { smartStaffService } from "../services/smart-staff.service.js";
import { staffEnterpriseService } from "../services/staff-enterprise.service.js";
import { validateBody } from "../validators/request-validator.js";

export const staffManagementRouter = Router();

staffManagementRouter.get(
  "/staff-management/profile/:staffId",
  requirePermission("read", () => "staff"),
  asyncHandler((req, res) => {
    res.json(staffEnterpriseService.profile(req.params.staffId, req.access));
  })
);

staffManagementRouter.patch(
  "/staff-management/staff/:staffId/service-staff",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.json(staffEnterpriseService.setServiceStaff(req.params.staffId, req.body.isServiceStaff, req.access));
  })
);

staffManagementRouter.get(
  "/staff-management/summary",
  requirePermission("read", () => "staff"),
  asyncHandler((req, res) => {
    res.json(smartStaffService.summary(req.query, req.access));
  })
);

staffManagementRouter.get(
  "/staff-management/performance",
  requirePermission("read", () => "staff"),
  asyncHandler((req, res) => {
    res.json(smartStaffService.performance(req.query, req.access));
  })
);

staffManagementRouter.get(
  "/staff-management/runs",
  requirePermission("read", () => "staff"),
  asyncHandler((req, res) => {
    res.json(smartStaffService.latestRuns(req.query, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/attendance",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId", "status"] }),
  asyncHandler((req, res) => {
    res.status(201).json(smartStaffService.recordAttendance(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/shifts",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId", "date", "startTime", "endTime"] }),
  asyncHandler((req, res) => {
    res.status(201).json(smartStaffService.planShift(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/shifts/:id/move",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.json(staffEnterpriseService.moveShift(req.params.id, req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/biometric-events",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["employeeCode", "eventType"] }),
  asyncHandler((req, res) => {
    res.status(201).json(staffEnterpriseService.recordBiometricEvent(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/leave",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId", "startDate"] }),
  asyncHandler((req, res) => {
    res.status(201).json(staffEnterpriseService.createLeave(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/leave/:id/:status",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.json(staffEnterpriseService.decideLeave(req.params.id, req.params.status, req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/payroll-components",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId"] }),
  asyncHandler((req, res) => {
    res.status(201).json(staffEnterpriseService.createPayrollComponent(req.body, req.access));
  })
);

staffManagementRouter.get(
  "/staff-management/payroll-components/:id/payslip.pdf",
  requirePermission("read", () => "staff"),
  asyncHandler((req, res) => {
    res.type("application/pdf").send(staffEnterpriseService.payslipPdf(req.params.id, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/commission-rules",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId"] }),
  asyncHandler((req, res) => {
    res.status(201).json(staffEnterpriseService.createCommissionRule(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/documents",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId", "documentType"] }),
  asyncHandler((req, res) => {
    res.status(201).json(staffEnterpriseService.createDocument(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/documents/:id/upload",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.json(staffEnterpriseService.uploadDocument(req.params.id, req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/skills",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId", "skillName"] }),
  asyncHandler((req, res) => {
    res.status(201).json(staffEnterpriseService.createSkill(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/reviews",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId"] }),
  asyncHandler((req, res) => {
    res.status(201).json(staffEnterpriseService.createReview(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/notifications/draft",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId"] }),
  asyncHandler((req, res) => {
    res.status(201).json(staffEnterpriseService.createNotificationDraft(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/notifications/:id/copied",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.json(staffEnterpriseService.markNotificationCopied(req.params.id, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/notifications/:id/send-whatsapp",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.json(staffEnterpriseService.sendNotificationWhatsapp(req.params.id, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/transfers",
  requirePermission("write", () => "staff"),
  validateBody({ required: ["staffId", "toBranchId"] }),
  asyncHandler((req, res) => {
    res.status(201).json(staffEnterpriseService.createTransfer(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/transfers/:id/approve",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.json(staffEnterpriseService.approveTransfer(req.params.id, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/commissions/run",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.status(201).json(smartStaffService.runCommission(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/incentives/calculate",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.json(smartStaffService.calculateIncentives(req.body, req.access));
  })
);

staffManagementRouter.post(
  "/staff-management/payroll/export",
  requirePermission("write", () => "staff"),
  asyncHandler((req, res) => {
    res.status(201).json(smartStaffService.exportPayroll(req.body, req.access));
  })
);
