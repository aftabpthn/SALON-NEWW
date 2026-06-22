import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { discountBudgetRepo } from "../repositories/discount-budget.repo.js";
import { badRequest } from "../utils/app-error.js";

export const discountBudgetRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.body?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.body?.branchId || req.query?.branchId || "",
    userId: req.access?.userId || req.header("x-user-id") || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

function positivePaise(value, field) {
  const amount = Math.round(Number(value || 0));
  if (!Number.isFinite(amount) || amount < 0) throw badRequest(`${field} must be integer paise`);
  return amount;
}

discountBudgetRouter.get(
  "/current",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const budget = discountBudgetRepo.getCurrentBudget({
      ...current,
      currentDate: req.query.currentDate
    });
    res.json({
      configured: Boolean(budget),
      budget,
      remainingPaise: budget?.remainingPaise ?? null
    });
  })
);

discountBudgetRouter.post(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    if (req.body.budgetPaise === undefined) throw badRequest("budgetPaise is required");
    const budget = discountBudgetRepo.setBudget({
      ...req.body,
      tenantId: current.tenantId,
      branchId: current.branchId,
      budgetPaise: positivePaise(req.body.budgetPaise, "budgetPaise"),
      createdBy: req.body.createdBy || current.userId || null
    });
    res.status(201).json(budget);
  })
);

discountBudgetRouter.get(
  "/alerts",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    res.json({
      alerts: discountBudgetRepo.alerts({
        ...current,
        currentDate: req.query.currentDate,
        limit: req.query.limit
      })
    });
  })
);
