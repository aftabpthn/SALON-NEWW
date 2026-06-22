import { policyInheritanceRepo } from "../repositories/policy-inheritance.repo.js";
import { rulesEngine } from "./rules-engine.js";

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function policyViolations(result = {}, policy = {}, context = {}) {
  const violations = [];
  const totalDiscountPaise = intPaise(result.totalDiscountPaise);
  const basePaise = intPaise(context.cartTotalPaise ?? context.servicePricePaise);
  if (policy.maxDiscountPercent !== null && policy.maxDiscountPercent !== undefined && basePaise > 0) {
    const allowedPaise = Math.floor((basePaise * Number(policy.maxDiscountPercent)) / 100);
    if (totalDiscountPaise > allowedPaise) {
      violations.push({
        type: "max_discount_percent",
        allowedPaise,
        actualPaise: totalDiscountPaise,
        message: "Calculated discount exceeds inherited max discount percent."
      });
    }
  }
  if (policy.maxFlatDiscountPaise !== null && policy.maxFlatDiscountPaise !== undefined) {
    const allowedPaise = intPaise(policy.maxFlatDiscountPaise);
    if (totalDiscountPaise > allowedPaise) {
      violations.push({
        type: "max_flat_discount_paise",
        allowedPaise,
        actualPaise: totalDiscountPaise,
        message: "Calculated discount exceeds inherited flat discount cap."
      });
    }
  }
  if (policy.stackableAllowed === false && Array.isArray(result.appliedRules) && result.appliedRules.length > 1) {
    violations.push({
      type: "stacking_not_allowed",
      actualRules: result.appliedRules.length,
      message: "Multiple rules matched while inherited policy disables stacking."
    });
  }
  if (policy.budgetRequired === true && result.guardrails?.budget?.configured === false) {
    violations.push({
      type: "budget_required",
      message: "Inherited policy requires a discount budget, but no active budget is configured."
    });
  }
  return violations;
}

export function evaluateWithPolicy(context = {}) {
  const result = rulesEngine.evaluate(context);
  if (!context.tenantId || !context.branchId) return result;
  try {
    const inheritance = policyInheritanceRepo.resolvePolicyChain({
      tenantId: context.tenantId,
      branchId: context.policyScopeBranchId || context.branchId,
      targetBranchId: context.branchId
    });
    return {
      ...result,
      policyInheritance: {
        ...inheritance,
        advisoryOnly: true,
        violations: policyViolations(result, inheritance.effectivePolicy, context)
      }
    };
  } catch (error) {
    return {
      ...result,
      policyInheritance: {
        available: false,
        advisoryOnly: true,
        error: error.message || "Policy inheritance unavailable"
      }
    };
  }
}

export const policyAwareRulesEngine = {
  evaluate: evaluateWithPolicy
};
