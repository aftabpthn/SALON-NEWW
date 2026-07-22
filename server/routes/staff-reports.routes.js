import { Router } from "express";
import { staffSalesReportService } from "../services/staff-sales-report.service.js";
import { staffReportsService } from "../services/staff-reports.service.js";
import { route } from "./staff-os-route-utils.js";
import { requireStaffAppSelfOrPermission } from "../middleware/rbac.js";
import { derivedStaffQuery, managedStaffAccess } from "../middleware/staff-self-context.middleware.js";

export const staffReportsRouter = Router();

staffReportsRouter.get("/staff-os/staff-sales", requireStaffAppSelfOrPermission("read", "staff-app-sales"), derivedStaffQuery(), route((req, res) => res.json(staffSalesReportService.report(req.query, managedStaffAccess(req.access)))));

for (const type of ["revenue", "attendance", "payroll", "commission", "tips", "utilization", "training", "productivity"]) {
  const resource = ["attendance", "training", "productivity", "utilization"].includes(type) ? "staff-app-staff" : type === "payroll" ? "staff-app-payroll" : "staff-app-finance";
  staffReportsRouter.get(`/staff-os/reports/${type}`, requireStaffAppSelfOrPermission("read", resource), derivedStaffQuery(), route((req, res) => res.json(staffReportsService.report(type, req.query, managedStaffAccess(req.access)))));
}
