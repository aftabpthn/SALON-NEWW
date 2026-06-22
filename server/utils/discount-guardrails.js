import { marginConfig } from "../config/margin-config.js";
import { discountBudgetRepo } from "../repositories/discount-budget.repo.js";

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function qty(item = {}) {
  return Math.max(1, Number(item.qty ?? item.quantity ?? 1) || 1);
}

function hasCost(item = {}) {
  return item.costPaise !== undefined
    || item.unitCostPaise !== undefined
    || item.cost_price_paise !== undefined
    || item.costPricePaise !== undefined;
}

function itemCostPaise(item = {}) {
  const raw = item.unitCostPaise ?? item.costPaise ?? item.costPricePaise ?? item.cost_price_paise ?? 0;
  return intPaise(raw) * qty(item);
}

function targetItems(action = {}, context = {}) {
  const cartItems = Array.isArray(context.cartItems) ? context.cartItems : [];
  if (!Array.isArray(action.targetIds) || !action.targetIds.length) return cartItems;
  const targets = new Set(action.targetIds.map((id) => String(id)));
  if (action.applyTo === "service") {
    return cartItems.filter((item) => targets.has(String(item.serviceId ?? item.itemId ?? item.item_id ?? "")));
  }
  if (action.applyTo === "category") {
    return cartItems.filter((item) => targets.has(String(item.categoryId ?? item.category ?? item.serviceCategory ?? "")));
  }
  return cartItems;
}

export function costBasisPaise(action = {}, context = {}) {
  const explicitCost = context.cartCostPaise ?? context.totalCostPaise ?? context.costPaise ?? context.serviceCostPaise;
  if (explicitCost !== undefined && explicitCost !== null && explicitCost !== "") return intPaise(explicitCost);

  const items = targetItems(action, context);
  if (!items.length || !items.some(hasCost)) return null;
  return items.reduce((sum, item) => sum + itemCostPaise(item), 0);
}

export function checkBudgetGuard({
  tenantId,
  branchId,
  requestedPaise,
  discountPaise,
  currentDate
} = {}) {
  if (!tenantId || !branchId) {
    return {
      allowed: false,
      blocked: true,
      configured: false,
      requestedPaise: intPaise(requestedPaise ?? discountPaise),
      remainingPaise: 0,
      reason: "tenant_branch_required"
    };
  }

  const check = discountBudgetRepo.checkRemaining({
    tenantId,
    branchId,
    currentDate,
    requestedPaise: intPaise(requestedPaise ?? discountPaise)
  });

  return {
    ...check,
    blocked: !check.allowed
  };
}

export function checkMarginGuard({
  discountPaise,
  sellPricePaise,
  costPaise,
  minMarginPercent = marginConfig.minMarginPercent
} = {}) {
  const originalDiscountPaise = intPaise(discountPaise);
  const sellPaise = intPaise(sellPricePaise);
  const minMargin = Math.min(95, Math.max(0, Number(minMarginPercent ?? marginConfig.minMarginPercent) || 0));

  if (originalDiscountPaise <= 0) {
    return {
      allowed: true,
      capped: false,
      denied: false,
      originalDiscountPaise,
      cappedDiscountPaise: 0,
      maxSafeDiscountPaise: 0,
      minMarginPercent: minMargin,
      reason: "no_discount"
    };
  }

  if (sellPaise <= 0) {
    return {
      allowed: false,
      capped: true,
      denied: true,
      originalDiscountPaise,
      cappedDiscountPaise: 0,
      maxSafeDiscountPaise: 0,
      minMarginPercent: minMargin,
      reason: "sell_price_required"
    };
  }

  if (costPaise === null || costPaise === undefined || costPaise === "") {
    return {
      allowed: true,
      capped: false,
      denied: false,
      originalDiscountPaise,
      cappedDiscountPaise: Math.min(originalDiscountPaise, sellPaise),
      maxSafeDiscountPaise: sellPaise,
      minMarginPercent: minMargin,
      reason: "cost_not_available"
    };
  }

  const cost = intPaise(costPaise);
  const requiredNetPaise = Math.ceil(cost / (1 - minMargin / 100));
  const maxSafeDiscountPaise = Math.max(0, sellPaise - requiredNetPaise);
  const cappedDiscountPaise = Math.min(originalDiscountPaise, maxSafeDiscountPaise);
  const capped = cappedDiscountPaise < originalDiscountPaise;

  return {
    allowed: cappedDiscountPaise > 0 || originalDiscountPaise === 0,
    capped,
    denied: originalDiscountPaise > 0 && cappedDiscountPaise === 0,
    originalDiscountPaise,
    cappedDiscountPaise,
    maxSafeDiscountPaise,
    minMarginPercent: minMargin,
    sellPricePaise: sellPaise,
    costPaise: cost,
    reason: capped ? "margin_floor_applied" : "margin_available"
  };
}

export function capDiscountWithMargin(result = {}, context = {}) {
  const margin = checkMarginGuard({
    discountPaise: result.discountPaise,
    sellPricePaise: result.sellPricePaise,
    costPaise: costBasisPaise(result.action, context),
    minMarginPercent: context.minMarginPercent
  });

  return {
    ...result,
    originalDiscountPaise: margin.originalDiscountPaise,
    discountPaise: margin.cappedDiscountPaise,
    guardrails: {
      ...(result.guardrails || {}),
      margin
    }
  };
}
