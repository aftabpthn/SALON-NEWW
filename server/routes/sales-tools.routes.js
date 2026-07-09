import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { authenticateJwt } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { salesToolsSummaryService } from "../services/sales-tools-summary.service.js";

export const salesToolsRouter = Router();

salesToolsRouter.use(authenticateJwt());

salesToolsRouter.get(
  "/sales-tools/summary",
  requirePermission("read", () => "marketing"),
  asyncHandler((req, res) => {
    res.json(salesToolsSummaryService.summary(req.query, req.access));
  })
);
