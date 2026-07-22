import { Router } from "express";
import { staffPayrollHistoryReportService } from "../services/staff-payroll-history-report.service.js";
import { staffPayrollService } from "../services/staff-payroll.service.js";
import { route } from "./staff-os-route-utils.js";
import { requireStaffAppPermission, requireStaffAppSelfOrPermission } from "../middleware/rbac.js";
import { derivedStaffQuery, managedStaffAccess } from "../middleware/staff-self-context.middleware.js";

export const staffPayrollRouter = Router();

const canReadOwnPayroll = requireStaffAppSelfOrPermission("read", "staff-app-payroll");
const canManagePayroll = requireStaffAppPermission("write", "staff-app-payroll");

staffPayrollRouter.get("/staff-os/payroll/history-report", canReadOwnPayroll, derivedStaffQuery(), route((req, res) => res.json(staffPayrollHistoryReportService.report(req.query, managedStaffAccess(req.access)))));
staffPayrollRouter.get("/staff-os/payroll", canReadOwnPayroll, derivedStaffQuery(), route((req, res) => res.json(staffPayrollService.listPayroll(req.query, managedStaffAccess(req.access)))));
staffPayrollRouter.post("/staff-os/payroll/generate", canManagePayroll, route((req, res) => res.status(201).json(staffPayrollService.generatePayroll(req.body, req.access))));
staffPayrollRouter.post("/staff-os/payroll/:id/approve", canManagePayroll, route((req, res) => res.json(staffPayrollService.approvePayroll(req.params.id, req.access))));
staffPayrollRouter.post("/staff-os/payroll/:id/mark-paid", canManagePayroll, route((req, res) => res.json(staffPayrollService.markPayrollPaid(req.params.id, req.access))));
