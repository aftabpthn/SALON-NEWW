import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { demandSignalsRepo } from "../repositories/demand-signals.repo.js";
import { badRequest } from "../utils/app-error.js";

export const demandSignalsRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || req.query?.branch_id || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

demandSignalsRouter.get(
  "/export",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const rows = demandSignalsRepo.exportTrainingData({
      ...current,
      from: req.query.from || null,
      to: req.query.to || null
    });

    if (req.query.format === "csv") {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", "attachment; filename=demand-signals.csv");
      res.send(demandSignalsRepo.rowsToCsv(rows));
      return;
    }

    res.json({ rows, count: rows.length });
  })
);

demandSignalsRouter.get(
  "/heatmap",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const cells = demandSignalsRepo.heatmap({
      ...current,
      from: req.query.from || null,
      to: req.query.to || null
    });
    res.json({ cells });
  })
);
