import { discountRulesRepo } from "../repositories/discount-rules.repo.js";
import { checkBudgetGuard, checkMarginGuard, costBasisPaise } from "./discount-guardrails.js";
import { computeAction, evaluateRule } from "./rules-engine.js";

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function qty(value) {
  return Math.max(1, Number(value || 1) || 1);
}

function itemTotalPaise(item = {}) {
  return intPaise(item.pricePaise ?? item.unitPricePaise) * qty(item.qty ?? item.quantity);
}

function normalizeCartItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    itemId: String(item.itemId || item.serviceId || `item_${index + 1}`),
    serviceId: item.serviceId || item.itemId || "",
    categoryId: item.categoryId || item.category || item.serviceCategory || "",
    name: String(item.name || item.serviceName || `Item ${index + 1}`),
    pricePaise: intPaise(item.pricePaise ?? item.unitPricePaise),
    costPaise: item.costPaise === undefined && item.unitCostPaise === undefined ? undefined : intPaise(item.costPaise ?? item.unitCostPaise),
    qty: qty(item.qty ?? item.quantity)
  }));
}

function cartTotalPaise(items = []) {
  return items.reduce((sum, item) => sum + itemTotalPaise(item), 0);
}

function currentDate() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

function normalizeContext(data = {}) {
  const cartItems = normalizeCartItems(data.cartItems || data.items || []);
  const totalPaise = intPaise(data.cartTotalPaise || cartTotalPaise(cartItems));
  return {
    ...data.context,
    ...data,
    cartItems,
    cartTotalPaise: totalPaise,
    servicePricePaise: intPaise(data.servicePricePaise || totalPaise),
    currentDate: String(data.currentDate || data.date || currentDate()).slice(0, 10),
    dayOfWeek: data.dayOfWeek ?? data.context?.dayOfWeek,
    hourSlot: data.hourSlot ?? data.context?.hourSlot
  };
}

function marginImpactFor(result = {}, context = {}) {
  const costPaise = costBasisPaise(result.action, context);
  const margin = checkMarginGuard({
    discountPaise: result.discountPaise,
    sellPricePaise: result.sellPricePaise,
    costPaise,
    minMarginPercent: context.minMarginPercent
  });
  return {
    ...margin,
    impactPaise: Math.max(0, margin.originalDiscountPaise - margin.cappedDiscountPaise)
  };
}

export function simulateDiscount(data = {}) {
  const tenantId = String(data.tenantId || "").trim();
  const branchId = String(data.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");

  const context = normalizeContext({ ...data, tenantId, branchId });
  const rules = discountRulesRepo.getActiveRules({
    tenantId,
    branchId,
    currentDate: context.currentDate
  });
  const matchedRules = rules.filter((rule) => evaluateRule(rule, context));
  const breakdown = [];
  const marginImpacts = [];
  let attemptedDiscountPaise = 0;
  let projectedDiscountPaise = 0;
  let stackingAllowed = true;

  for (const rule of matchedRules) {
    if (!stackingAllowed) break;
    const action = computeAction(rule, context);
    const margin = marginImpactFor(action, context);
    const projected = {
      ...action,
      originalDiscountPaise: margin.originalDiscountPaise,
      discountPaise: margin.cappedDiscountPaise,
      guardrails: { margin }
    };
    attemptedDiscountPaise += action.discountPaise;
    if (projected.discountPaise > 0) {
      breakdown.push(projected);
      projectedDiscountPaise += projected.discountPaise;
      if (!rule.stackable) stackingAllowed = false;
    }
    if (margin.capped || margin.denied) {
      marginImpacts.push({
        ruleId: rule.id,
        ruleName: rule.name,
        originalDiscountPaise: margin.originalDiscountPaise,
        cappedDiscountPaise: margin.cappedDiscountPaise,
        impactPaise: margin.impactPaise,
        reason: margin.reason
      });
    }
  }

  const budget = checkBudgetGuard({
    tenantId,
    branchId,
    currentDate: context.currentDate,
    requestedPaise: projectedDiscountPaise
  });
  const blockedByBudget = !budget.allowed;
  const finalDiscountPaise = blockedByBudget ? 0 : projectedDiscountPaise;
  const grossPaise = intPaise(context.cartTotalPaise);

  return {
    tenantId,
    branchId,
    simulationOnly: true,
    persistedDiscountApplication: false,
    context,
    matchedRules: matchedRules.map((rule) => ({ id: rule.id, name: rule.name, priority: rule.priority, stackable: rule.stackable })),
    appliedRules: blockedByBudget ? [] : breakdown.map((item) => item.ruleId),
    breakdown: blockedByBudget ? [] : breakdown,
    attemptedDiscountPaise,
    projectedDiscountPaise: finalDiscountPaise,
    payablePaise: Math.max(0, grossPaise - finalDiscountPaise),
    grossPaise,
    marginImpact: {
      totalImpactPaise: marginImpacts.reduce((sum, item) => sum + intPaise(item.impactPaise), 0),
      cappedRules: marginImpacts
    },
    guardrails: {
      budget,
      margin: { cappedRules: marginImpacts }
    },
    blocked: blockedByBudget,
    blockReason: blockedByBudget ? "discount_budget_exceeded" : null
  };
}

export const discountSimulator = {
  simulateDiscount
};
