function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function text(value) {
  return String(value ?? "").trim().toLowerCase();
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(",").map(text).filter(Boolean);
}

function normalizeRule(rule = {}) {
  const conditions = rule.conditionsJson || parseJson(rule.conditions, []);
  const action = rule.actionJson || parseJson(rule.action, {});
  return {
    ...rule,
    id: rule.id || rule.draftId || "draft",
    name: rule.name || "Draft rule",
    status: rule.status || "draft",
    priority: Number.parseInt(rule.priority, 10) || 100,
    stackable: Boolean(rule.stackable),
    validFrom: rule.validFrom || null,
    validTo: rule.validTo || null,
    conditions: Array.isArray(conditions) ? conditions : [],
    action
  };
}

function actionTarget(rule = {}) {
  const action = rule.action || {};
  const applyTo = text(action.applyTo || "cart");
  const targetIds = list(action.targetIds);
  return `${applyTo}:${targetIds.length ? targetIds.sort().join("|") : "all"}`;
}

function actionValue(rule = {}) {
  const action = rule.action || {};
  return `${text(action.type || "percent")}:${Number(action.value || 0)}:${Number(action.maxDiscountPaise || 0)}`;
}

function discountPercent(rule = {}) {
  return text(rule.action?.type || "percent") === "percent" ? Math.max(0, Number(rule.action?.value || 0)) : 0;
}

function dateOverlap(a = {}, b = {}) {
  const aStart = a.validFrom || "0000-01-01";
  const aEnd = a.validTo || "9999-12-31";
  const bStart = b.validFrom || "0000-01-01";
  const bEnd = b.validTo || "9999-12-31";
  return aStart <= bEnd && bStart <= aEnd;
}

function conditionMap(rule = {}) {
  const map = new Map();
  for (const condition of rule.conditions || []) {
    const field = text(condition.field);
    if (!field) continue;
    if (!map.has(field)) map.set(field, []);
    map.get(field).push(condition);
  }
  return map;
}

function valuesOverlap(left = [], right = []) {
  if (!left.length || !right.length) return true;
  return left.some((value) => right.includes(value));
}

function conditionOverlap(a = {}, b = {}) {
  if (text(a.operator) === "neq" || text(b.operator) === "neq") return true;
  const aValues = list(a.value);
  const bValues = list(b.value);
  if (["gte", "gt", "lte", "lt", "between"].includes(text(a.operator)) || ["gte", "gt", "lte", "lt", "between"].includes(text(b.operator))) return true;
  return valuesOverlap(aValues, bValues);
}

function rulesOverlap(a = {}, b = {}) {
  if (!dateOverlap(a, b)) return false;
  const aMap = conditionMap(a);
  const bMap = conditionMap(b);
  for (const field of aMap.keys()) {
    if (!bMap.has(field)) continue;
    const overlaps = aMap.get(field).some((left) => bMap.get(field).some((right) => conditionOverlap(left, right)));
    if (!overlaps) return false;
  }
  return true;
}

function severityFor(type, a = {}, b = {}) {
  if (type === "stacking_risk") return discountPercent(a) + discountPercent(b) >= 40 ? "critical" : "high";
  if (type === "discount_collision") return Math.abs(discountPercent(a) - discountPercent(b)) >= 15 ? "high" : "medium";
  if (type === "priority_tie") return "medium";
  return "low";
}

function conflict(type, a, b, reason, recommendation) {
  const severity = severityFor(type, a, b);
  return {
    id: `${type}:${a.id}:${b.id}`,
    type,
    severity,
    ruleIds: [a.id, b.id],
    ruleNames: [a.name, b.name],
    statuses: [a.status, b.status],
    reason,
    recommendation,
    evidence: {
      priority: [a.priority, b.priority],
      actionTarget: actionTarget(a),
      actionValues: [actionValue(a), actionValue(b)],
      stackable: [a.stackable, b.stackable],
      validFrom: [a.validFrom, b.validFrom],
      validTo: [a.validTo, b.validTo]
    }
  };
}

function pairConflicts(a, b) {
  if (!rulesOverlap(a, b)) return [];
  const conflicts = [];
  const sameTarget = actionTarget(a) === actionTarget(b);
  if (!sameTarget) return conflicts;
  if (actionValue(a) === actionValue(b)) {
    conflicts.push(conflict("duplicate_coverage", a, b, "Rules target the same audience with the same discount.", "Keep the clearer rule and pause/archive the duplicate."));
  } else {
    conflicts.push(conflict("discount_collision", a, b, "Rules target the same audience but produce different discounts.", "Adjust conditions, priority, or validity dates so one winner is obvious."));
  }
  if (a.priority === b.priority) {
    conflicts.push(conflict("priority_tie", a, b, "Rules overlap with the same priority.", "Give the more specific rule higher priority."));
  }
  if (a.stackable && b.stackable && discountPercent(a) + discountPercent(b) > 30) {
    conflicts.push(conflict("stacking_risk", a, b, "Both rules can stack and combined percent discount is high.", "Disable stacking on one rule or reduce the cap."));
  }
  return conflicts;
}

export function detectRuleConflicts(rules = []) {
  const normalized = rules.map(normalizeRule);
  const conflicts = [];
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      conflicts.push(...pairConflicts(normalized[i], normalized[j]));
    }
  }
  const severityCounts = conflicts.reduce((acc, row) => {
    acc[row.severity] = (acc[row.severity] || 0) + 1;
    return acc;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    scannedRules: normalized.length,
    conflictCount: conflicts.length,
    severityCounts,
    conflicts
  };
}

export const ruleConflictDetector = {
  detect: detectRuleConflicts
};
