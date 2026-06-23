import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { clientDiscountBrainRepo } from "../repositories/client-discount-brain.repo.js";
import { clvRepo } from "../repositories/clv.repo.js";
import { badRequest } from "../utils/app-error.js";

export const clientDiscountBrainRouter = Router();

function scope(req) {
  const tenantId = req.header("x-tenant-id") || req.access?.tenantId || req.query?.tenantId || req.body?.tenantId || "";
  const branchId = req.header("x-branch-id") || req.access?.branchId || req.query?.branchId || req.body?.branchId || "";
  if (!tenantId || !branchId) throw badRequest("tenantId and branchId are required");
  return { tenantId, branchId };
}

function input(req) {
  return {
    ...scope(req),
    clientId: req.query.clientId || req.body?.clientId,
    serviceCategory: req.query.serviceCategory || req.body?.serviceCategory,
    cartTotalPaise: req.query.cartTotalPaise || req.body?.cartTotalPaise,
    baseDiscountPercent: req.query.baseDiscountPercent || req.body?.baseDiscountPercent
  };
}

clientDiscountBrainRouter.get(
  "/evaluate",
  asyncHandler((req, res) => {
    try {
      res.json(clientDiscountBrainRepo.evaluateClientDiscount(input(req)));
    } catch (error) {
      throw badRequest(error.message || "Unable to evaluate client discount");
    }
  })
);

clientDiscountBrainRouter.post(
  "/decisions",
  asyncHandler((req, res) => {
    try {
      res.status(201).json({ decision: clientDiscountBrainRepo.recordDecision(input(req)) });
    } catch (error) {
      throw badRequest(error.message || "Unable to record client discount decision");
    }
  })
);

clientDiscountBrainRouter.get(
  "/decisions",
  asyncHandler((req, res) => {
    res.json({ rows: clientDiscountBrainRepo.recentDecisions({ ...scope(req), limit: req.query.limit }) });
  })
);

clientDiscountBrainRouter.get(
  "/top-clv",
  asyncHandler((req, res) => {
    res.json({ rows: clvRepo.getTopClvClients({ ...scope(req), limit: req.query.limit }) });
  })
);

clientDiscountBrainRouter.get(
  "/at-risk",
  asyncHandler((req, res) => {
    res.json({
      rows: clvRepo.getAtRiskClients({
        ...scope(req),
        limit: req.query.limit,
        minCurrentValuePaise: req.query.minCurrentValuePaise
      })
    });
  })
);
