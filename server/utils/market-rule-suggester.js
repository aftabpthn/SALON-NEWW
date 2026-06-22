import { competitorPricesRepo } from "../repositories/competitor-prices.repo.js";
import { discountRulesRepo } from "../repositories/discount-rules.repo.js";

const MAX_MARKET_DISCOUNT_PERCENT = 40;
const DEFAULT_PRIORITY = 70;

function cleanScope(data = {}) {
  const tenantId = String(data.tenantId || "").trim();
  const branchId = String(data.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function cleanServiceCategory(value) {
  const serviceCategory = String(value || "").trim().toLowerCase();
  if (!serviceCategory) throw new Error("serviceCategory is required");
  return serviceCategory;
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function percent(value) {
  return Math.min(100, Math.max(0, Number(value || 0)));
}

function dateOrNull(value) {
  const raw = String(value || "").trim();
  return raw ? raw.slice(0, 10) : null;
}

function labelFor(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inactiveSuggestion({ scope, serviceCategory, position, reason }) {
  return {
    ...scope,
    eligible: false,
    reason,
    serviceCategory,
    marketPosition: position,
    recommendedDiscountPercent: position.recommendedDiscountPercent || 0,
    rulePayload: null,
    previewSentence: "Market data abhi draft rule ke liye strong nahi hai.",
    guardrails: [
      "Draft rules are suggested only from manual or public competitor prices.",
      "No rule is auto-activated from market intelligence.",
      "Final approval and margin checks stay in the existing Happy Hours flow."
    ]
  };
}

export function buildMarketRuleSuggestion(data = {}) {
  const scope = cleanScope(data);
  const serviceCategory = cleanServiceCategory(data.serviceCategory);
  const ourPricePaise = intPaise(data.ourPricePaise);
  const baseDiscountPercent = percent(data.baseDiscountPercent);
  const position = competitorPricesRepo.getPricePosition({
    ...scope,
    serviceCategory,
    ourPricePaise,
    baseDiscountPercent
  });

  if (position.position === "unknown" || !position.competitorCount) {
    return inactiveSuggestion({
      scope,
      serviceCategory,
      position,
      reason: "Add competitor prices and our service price before creating a market-based draft rule."
    });
  }

  if (position.position !== "above_market") {
    return inactiveSuggestion({
      scope,
      serviceCategory,
      position,
      reason: "Our effective price is already inside or below the current manual market band."
    });
  }

  const recommendedDiscountPercent = Math.min(
    MAX_MARKET_DISCOUNT_PERCENT,
    Math.max(baseDiscountPercent, Math.round(Number(position.recommendedDiscountPercent || 0)))
  );

  if (recommendedDiscountPercent <= baseDiscountPercent) {
    return inactiveSuggestion({
      scope,
      serviceCategory,
      position,
      reason: "Existing base discount already covers the market gap."
    });
  }

  const categoryLabel = labelFor(serviceCategory) || serviceCategory;
  const priceGapPercent = Number(position.priceGapPercent || 0);
  const maxDiscountPaise = intPaise(data.maxDiscountPaise);
  const rulePayload = {
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    name: `Market match - ${categoryLabel}`,
    description: `Draft suggested by Market Intel: ${categoryLabel} is ${priceGapPercent.toFixed(1)}% above manual competitor average.`,
    conditions: [
      { field: "serviceCategory", operator: "in", value: [serviceCategory] },
      { field: "occupancyRate", operator: "lt", value: 0.5 }
    ],
    conditionLogic: "AND",
    action: {
      type: "percent",
      value: recommendedDiscountPercent,
      maxDiscountPaise,
      applyTo: "category",
      targetIds: [serviceCategory]
    },
    priority: Number.parseInt(data.priority, 10) || DEFAULT_PRIORITY,
    stackable: false,
    status: "draft",
    validFrom: dateOrNull(data.validFrom),
    validTo: dateOrNull(data.validTo)
  };

  return {
    ...scope,
    eligible: true,
    reason: "Our price is above the manual market band; create a draft slow-hour rule for review.",
    serviceCategory,
    marketPosition: position,
    recommendedDiscountPercent,
    rulePayload,
    previewSentence: `${categoryLabel} ke slow hours me ${recommendedDiscountPercent}% draft offer suggest hai, because our effective price market average se ${priceGapPercent.toFixed(1)}% higher hai.`,
    guardrails: [
      "Creates draft rule only; never auto-active.",
      "Uses manual or publicly listed competitor prices only.",
      "Activation must still pass approval, budget, and margin guardrails."
    ]
  };
}

export function createDraftRuleFromMarketSuggestion(data = {}) {
  const suggestion = buildMarketRuleSuggestion(data);
  if (!suggestion.eligible || !suggestion.rulePayload) {
    throw new Error(suggestion.reason || "Market suggestion is not eligible for draft creation");
  }
  const rule = discountRulesRepo.create({
    ...suggestion.rulePayload,
    createdBy: String(data.createdBy || "market-intel").trim() || "market-intel"
  });
  return { suggestion, rule };
}

export const marketRuleSuggester = {
  buildMarketRuleSuggestion,
  createDraftRuleFromMarketSuggestion
};
