import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { competitorPricesRepo } from "../repositories/competitor-prices.repo.js";
import { badRequest } from "../utils/app-error.js";
import { getMarketAwareDiscount } from "../utils/market-pricer.js";
import { buildMarketRuleSuggestion, createDraftRuleFromMarketSuggestion } from "../utils/market-rule-suggester.js";

export const pricingMarketRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.body?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.body?.branchId || req.query?.branchId || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid competitive price intelligence request");
}

pricingMarketRouter.get(
  "/competitors",
  asyncHandler((req, res) => {
    try {
      res.json(competitorPricesRepo.listCompetitors({
        ...requireScope(req),
        limit: req.query.limit,
        offset: req.query.offset
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingMarketRouter.post(
  "/competitors",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(competitorPricesRepo.addCompetitor({
        ...req.body,
        ...requireScope(req)
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingMarketRouter.get(
  "/competitor-prices",
  asyncHandler((req, res) => {
    try {
      res.json(competitorPricesRepo.listPrices({
        ...requireScope(req),
        serviceCategory: req.query.serviceCategory,
        limit: req.query.limit,
        offset: req.query.offset
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingMarketRouter.post(
  "/competitor-prices",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(competitorPricesRepo.recordPrice({
        ...req.body,
        ...requireScope(req)
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingMarketRouter.get(
  "/market-rate",
  asyncHandler((req, res) => {
    try {
      res.json(competitorPricesRepo.getMarketRate({
        ...requireScope(req),
        serviceCategory: req.query.serviceCategory
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingMarketRouter.get(
  "/market-position",
  asyncHandler((req, res) => {
    try {
      res.json(competitorPricesRepo.getPricePosition({
        ...requireScope(req),
        serviceCategory: req.query.serviceCategory,
        ourPricePaise: req.query.ourPricePaise,
        baseDiscountPercent: req.query.baseDiscountPercent
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingMarketRouter.post(
  "/market-aware-discount",
  asyncHandler((req, res) => {
    try {
      res.json(getMarketAwareDiscount({
        ...req.body,
        ...requireScope(req)
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingMarketRouter.post(
  "/market-rule-suggestion",
  asyncHandler((req, res) => {
    try {
      res.json(buildMarketRuleSuggestion({
        ...req.body,
        ...requireScope(req)
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

pricingMarketRouter.post(
  "/market-rule-suggestion/draft",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(createDraftRuleFromMarketSuggestion({
        ...req.body,
        ...requireScope(req),
        createdBy: req.access?.userId || req.header("x-user-id") || "market-intel"
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
