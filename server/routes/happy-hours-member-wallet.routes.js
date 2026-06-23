import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursMemberWalletRepo } from "../repositories/happy-hours-member-wallet.repo.js";
import { badRequest } from "../utils/app-error.js";

export const happyHoursMemberWalletRouter = Router();

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
    membershipId: req.query.membershipId || req.body?.membershipId,
    membershipStatus: req.query.membershipStatus || req.body?.membershipStatus,
    signalDate: req.query.signalDate || req.body?.signalDate,
    dayOfWeek: req.query.dayOfWeek || req.body?.dayOfWeek,
    hourSlot: req.query.hourSlot || req.body?.hourSlot,
    cartTotalPaise: req.query.cartTotalPaise || req.body?.cartTotalPaise,
    servicePricePaise: req.query.servicePricePaise || req.body?.servicePricePaise,
    baseDiscountPercent: req.query.baseDiscountPercent || req.body?.baseDiscountPercent,
    walletBalancePaise: req.query.walletBalancePaise || req.body?.walletBalancePaise,
    loyaltyPoints: req.query.loyaltyPoints || req.body?.loyaltyPoints,
    creditsRemaining: req.query.creditsRemaining || req.body?.creditsRemaining,
    visitCount: req.query.visitCount || req.body?.visitCount,
    totalSpendPaise: req.query.totalSpendPaise || req.body?.totalSpendPaise,
    validityDate: req.query.validityDate || req.body?.validityDate
  };
}

function asBadRequest(error, fallback) {
  return badRequest(error.message || fallback);
}

happyHoursMemberWalletRouter.get(
  "/evaluate",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursMemberWalletRepo.evaluate(input(req)));
    } catch (error) {
      throw asBadRequest(error, "Unable to evaluate member wallet offers");
    }
  })
);

happyHoursMemberWalletRouter.get(
  "/suggestions",
  asyncHandler((req, res) => {
    res.json(happyHoursMemberWalletRepo.listSuggestions({
      ...scope(req),
      status: req.query.status,
      limit: req.query.limit
    }));
  })
);

happyHoursMemberWalletRouter.post(
  "/suggestions",
  asyncHandler((req, res) => {
    try {
      res.status(201).json({ suggestion: happyHoursMemberWalletRepo.saveSuggestion(input(req)) });
    } catch (error) {
      throw asBadRequest(error, "Unable to save member wallet suggestion");
    }
  })
);

happyHoursMemberWalletRouter.patch(
  "/suggestions/:id/status",
  asyncHandler((req, res) => {
    try {
      res.json({
        suggestion: happyHoursMemberWalletRepo.updateStatus({
          ...scope(req),
          id: req.params.id,
          status: req.body?.status
        })
      });
    } catch (error) {
      throw asBadRequest(error, "Unable to update member wallet suggestion");
    }
  })
);
