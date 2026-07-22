import { Router } from "express";
import { staffPayrollComplianceService } from "../services/staff-payroll-compliance.service.js";
import { route } from "./staff-os-route-utils.js";
import { requireStaffAppPermission } from "../middleware/rbac.js";

export const staffPayrollComplianceRouter = Router();
const canReadPayroll = requireStaffAppPermission("read", "staff-app-payroll");
const canWritePayroll = requireStaffAppPermission("write", "staff-app-payroll");

staffPayrollComplianceRouter.get("/staff-os/payroll-compliance/rules", canReadPayroll, route((req, res) => res.json(staffPayrollComplianceService.listRules(req.query, req.access))));
staffPayrollComplianceRouter.post("/staff-os/payroll-compliance/rules", canWritePayroll, route((req, res) => res.status(201).json(staffPayrollComplianceService.createRule(req.body, req.access))));
staffPayrollComplianceRouter.get("/staff-os/payroll-compliance/summary", canReadPayroll, route((req, res) => res.json(staffPayrollComplianceService.summary(req.query, req.access))));
staffPayrollComplianceRouter.post("/staff-os/payroll-compliance/calculate", canWritePayroll, route((req, res) => res.status(201).json(staffPayrollComplianceService.calculate(req.body, req.access))));
staffPayrollComplianceRouter.post("/staff-os/payroll-compliance/export", canWritePayroll, route((req, res) => res.status(201).json(staffPayrollComplianceService.exportCompliance(req.body, req.access))));
staffPayrollComplianceRouter.get("/staff-os/staff/:id/salary-history", canReadPayroll, route((req, res) => res.json(staffPayrollComplianceService.salaryHistory(req.params.id, req.access))));
staffPayrollComplianceRouter.post("/staff-os/staff/:id/salary-revision", canWritePayroll, route((req, res) => res.status(201).json(staffPayrollComplianceService.createSalaryRevision(req.params.id, req.body, req.access))));
staffPayrollComplianceRouter.get("/staff-os/staff/:id/salary-revisions", canReadPayroll, route((req, res) => res.json(staffPayrollComplianceService.salaryHistory(req.params.id, req.access))));
staffPayrollComplianceRouter.post("/staff-os/staff/:id/salary-revisions", canWritePayroll, route((req, res) => res.status(201).json(staffPayrollComplianceService.createSalaryRevision(req.params.id, req.body, req.access))));
staffPayrollComplianceRouter.post("/staff-os/salary-revisions/:id/approve", canWritePayroll, route((req, res) => res.json(staffPayrollComplianceService.approveSalaryRevision(req.params.id, req.access))));
staffPayrollComplianceRouter.post("/staff-os/salary-revisions/:id/reject", canWritePayroll, route((req, res) => res.json(staffPayrollComplianceService.rejectSalaryRevision(req.params.id, req.access))));
staffPayrollComplianceRouter.post("/staff-os/salary-revisions/:id/correction", canWritePayroll, route((req, res) => res.status(201).json(staffPayrollComplianceService.correctSalaryRevision(req.params.id, req.body, req.access))));
