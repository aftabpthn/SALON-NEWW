import { Router } from "express";
import { staffPayrollHistoryReportService } from "../services/staff-payroll-history-report.service.js";
import { staffPayrollService } from "../services/staff-payroll.service.js";
import { route } from "./staff-os-route-utils.js";

export const staffPayrollRouter = Router();

staffPayrollRouter.get("/staff-os/payroll/history-report", route((req, res) => res.json(staffPayrollHistoryReportService.report(req.query, req.access))));
staffPayrollRouter.get("/staff-os/payroll", route((req, res) => res.json(staffPayrollService.listPayroll(req.query, req.access))));
staffPayrollRouter.post("/staff-os/payroll/generate", route((req, res) => res.status(201).json(staffPayrollService.generatePayroll(req.body, req.access))));
staffPayrollRouter.post("/staff-os/payroll/:id/approve", route((req, res) => res.json(staffPayrollService.approvePayroll(req.params.id, req.access))));
staffPayrollRouter.post("/staff-os/payroll/:id/mark-paid", route((req, res) => res.json(staffPayrollService.markPayrollPaid(req.params.id, req.access))));
