import { discountRulesRepo } from "../repositories/discount-rules.repo.js";
import { discountAuditLogRepo } from "../repositories/discount-audit-log.repo.js";
import { capDiscountWithMargin, checkBudgetGuard } from "./discount-guardrails.js";
import { emitDiscountWebhook } from "./webhook-dispatcher.js";

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function compareBetween(field, actual, value = {}) {
  if (field === "timeRange") return actual >= value.start && actual < value.end;
  if (field === "dateRange") return actual >= value.from && actual <= value.to;
  return actual >= value.min && actual <= value.max;
}

export function evaluateCondition(condition = {}, context = {}) {
  const { field, operator, value } = condition;
  const actual = context[field];

  switch (operator) {
    case "eq": return actual === value;
    case "neq": return actual !== value;
    case "lt": return actual < value;
    case "lte": return actual <= value;
    case "gt": return actual > value;
    case "gte": return actual >= value;
    case "in":
      if (!Array.isArray(value)) return false;
      if (Array.isArray(actual)) return actual.some((item) => value.includes(item));
      return value.includes(actual);
    case "between": return compareBetween(field, actual, value);
    default: return false;
  }
}

export function evaluateRule(rule = {}, context = {}) {
  const conditions = parseJson(rule.conditions, rule.conditionsJson || []);
  if (!conditions.length) return true;
  if (rule.conditionLogic === "OR") {
    return conditions.some((condition) => evaluateCondition(condition, context));
  }
  return conditions.every((condition) => evaluateCondition(condition, context));
}

function itemPricePaise(item = {}) {
  const price = Number(item.pricePaise ?? item.unitPricePaise ?? 0) || 0;
  const qty = Math.max(1, Number(item.qty ?? item.quantity ?? 1) || 1);
  return Math.max(0, Math.round(price * qty));
}

function actionBasePaise(action = {}, context = {}) {
  const cartItems = Array.isArray(context.cartItems) ? context.cartItems : [];
  if (action.applyTo === "service" && Array.isArray(action.targetIds) && action.targetIds.length) {
    const targets = new Set(action.targetIds.map((id) => String(id)));
    return cartItems
      .filter((item) => targets.has(String(item.serviceId ?? item.itemId ?? item.item_id ?? "")))
      .reduce((sum, item) => sum + itemPricePaise(item), 0);
  }
  if (action.applyTo === "category" && Array.isArray(action.targetIds) && action.targetIds.length) {
    const targets = new Set(action.targetIds.map((id) => String(id)));
    return cartItems
      .filter((item) => targets.has(String(item.categoryId ?? item.category ?? "")))
      .reduce((sum, item) => sum + itemPricePaise(item), 0);
  }
  return Math.max(0, Math.round(Number(context.cartTotalPaise ?? context.servicePricePaise ?? 0) || 0));
}

function audit(eventType, context = {}, payload = {}) {
  if (!context.tenantId || !context.branchId) return;
  try {
    discountAuditLogRepo.log({
      tenantId: context.tenantId,
      branchId: context.branchId,
      actorUserId: context.actorUserId || context.userId || null,
      actorRole: context.actorRole || context.role || null,
      source: context.auditSource || "rules-engine",
      eventType,
      gstImpactPaise: 0,
      gstImpactNote: "Exact GST delta unavailable in discount evaluation; gstImpactPaise stored as 0.",
      ...payload
    });
  } catch {
    // Discount evaluation must remain available even if audit persistence fails.
  }
  if (eventType === "discount_applied") {
    void emitDiscountWebhook(eventType, context, {
      eventKey: `${eventType}:${context.invoiceId || context.cartId || payload.ruleId || "cart"}:${Date.now()}`,
      data: {
        amountPaise: payload.amountPaise || 0,
        discountPaise: payload.discountPaise || 0,
        note: payload.note || "",
        metadata: payload.metadata || {}
      }
    });
  }
}

export function computeAction(rule = {}, context = {}) {
  const action = parseJson(rule.action, rule.actionJson || {});
  const base = actionBasePaise(action, context);
  let discountPaise = 0;

  if (action.type === "percent") {
    discountPaise = Math.floor(base * Number(action.value || 0) / 100);
  } else if (action.type === "flat") {
    discountPaise = Math.min(Number(action.value || 0), base);
  } else if (action.type === "bundle_price") {
    discountPaise = Math.max(0, base - Number(action.value || 0));
  }

  if (action.maxDiscountPaise > 0 && discountPaise > action.maxDiscountPaise) {
    discountPaise = action.maxDiscountPaise;
  }

  return {
    discountPaise: Math.max(0, Math.min(base, Math.round(discountPaise))),
    label: rule.name,
    ruleId: rule.id,
    action,
    sellPricePaise: base
  };
}

export function evaluate(context = {}) {
  const rules = discountRulesRepo.getActiveRules({
    tenantId: context.tenantId,
    branchId: context.branchId,
    currentDate: context.currentDate
  });
  const matched = rules.filter((rule) => evaluateRule(rule, context));
  if (!matched.length) return { appliedRules: [], totalDiscountPaise: 0, breakdown: [] };

  const breakdown = [];
  const marginCappedRules = [];
  let totalDiscountPaise = 0;
  let stackingAllowed = true;

  for (const rule of matched) {
    if (!stackingAllowed) break;
    const result = capDiscountWithMargin(computeAction(rule, context), context);
    if (result.guardrails?.margin?.capped) {
      marginCappedRules.push({
        ruleId: rule.id,
        originalDiscountPaise: result.guardrails.margin.originalDiscountPaise,
        cappedDiscountPaise: result.guardrails.margin.cappedDiscountPaise,
        maxSafeDiscountPaise: result.guardrails.margin.maxSafeDiscountPaise,
        reason: result.guardrails.margin.reason
      });
      audit("margin_blocked", context, {
        ruleId: rule.id,
        amountPaise: result.sellPricePaise,
        discountPaise: Math.max(0, result.guardrails.margin.originalDiscountPaise - result.guardrails.margin.cappedDiscountPaise),
        note: "Discount capped by minimum margin guardrail; GST impact unavailable and stored as 0.",
        metadata: { ruleName: rule.name, margin: result.guardrails.margin }
      });
    }
    if (result.discountPaise > 0) {
      breakdown.push(result);
      totalDiscountPaise += result.discountPaise;
      if (!rule.stackable) stackingAllowed = false;
    }
  }

  const budget = checkBudgetGuard({
    tenantId: context.tenantId,
    branchId: context.branchId,
    currentDate: context.currentDate,
    requestedPaise: totalDiscountPaise
  });

  if (!budget.allowed) {
    audit("budget_exceeded", context, {
      amountPaise: Number(context.cartTotalPaise ?? context.servicePricePaise ?? 0) || 0,
      discountPaise: totalDiscountPaise,
      note: "Discount blocked because configured budget remaining was insufficient; GST impact unavailable and stored as 0.",
      metadata: { budget, attemptedRules: breakdown.map((item) => item.ruleId) }
    });
    return {
      appliedRules: [],
      totalDiscountPaise: 0,
      breakdown: [],
      blocked: true,
      blockReason: "discount_budget_exceeded",
      guardrails: {
        budget,
        margin: { cappedRules: marginCappedRules }
      }
    };
  }

  if (context.auditDiscountApplication && totalDiscountPaise > 0) {
    audit("discount_applied", context, {
      amountPaise: Number(context.cartTotalPaise ?? context.servicePricePaise ?? 0) || 0,
      discountPaise: totalDiscountPaise,
      note: "Discount applied through rules engine; GST impact unavailable and stored as 0.",
      metadata: { appliedRules: breakdown.map((item) => item.ruleId), breakdown }
    });
  }

  return {
    appliedRules: breakdown.map((item) => item.ruleId),
    totalDiscountPaise,
    breakdown,
    guardrails: {
      budget,
      margin: { cappedRules: marginCappedRules }
    }
  };
}

export const rulesEngine = {
  evaluate,
  evaluateRule,
  evaluateCondition,
  computeAction
};
