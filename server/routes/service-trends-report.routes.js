import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { serviceTrendsReportService } from "../services/service-trends-report.service.js";

export const serviceTrendsReportRouter = Router();

serviceTrendsReportRouter.get("/reports/invoices/service-trends", requirePermission("read", () => "reports"), asyncHandler((req, res) => {
  res.json(serviceTrendsReportService.report(req.query, req.access));
}));
