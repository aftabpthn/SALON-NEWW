import { db } from "../db.js";
import { roleDiscountLimits } from "../config/role-discount-limits.js";
import { discountAnomaliesRepo } from "../repositories/discount-anomalies.repo.js";

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function tableColumns(tableName) {
  if (!tableExists(tableName)) return [];
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function epochStart(value) {
  if (!value) return Math.floor((Date.now() - 30 * 86400000) / 1000);
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+05:30`);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : Math.floor((Date.now() - 30 * 86400000) / 1000);
}

function epochEnd(value) {
  if (!value) return Math.floor(Date.now() / 1000);
  const date = new Date(`${String(value).slice(0, 10)}T23:59:59+05:30`);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : Math.floor(Date.now() / 1000);
}

function filters(scope = {}) {
  return {
    ...requireScope(scope),
    from: scope.from || "",
    to: scope.to || "",
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to)
  };
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function severityFromRatio(ratio) {
  if (ratio >= 4) return "critical";
  if (ratio >= 3) return "high";
  if (ratio >= 2) return "medium";
  return "low";
}

function dailyDiscountUsage(scope) {
  if (!tableExists("discountAuditLog")) return [];
  return db.prepare(`
    SELECT substr(datetime(createdAt, 'unixepoch', '+330 minutes'), 1, 10) AS businessDate,
           COUNT(*) AS applications,
           SUM(discountPaise) AS discountPaise,
           SUM(amountPaise) AS amountPaise
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND eventType = 'discount_applied'
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
    GROUP BY businessDate
    ORDER BY businessDate ASC
  `).all(scope).map((row) => ({
    ...row,
    applications: Number(row.applications || 0),
    discountPaise: intPaise(row.discountPaise),
    amountPaise: intPaise(row.amountPaise)
  }));
}

function eventSummary(scope, eventType) {
  if (!tableExists("discountAuditLog")) return { count: 0, discountPaise: 0, amountPaise: 0 };
  const row = db.prepare(`
    SELECT COUNT(*) AS count,
           SUM(discountPaise) AS discountPaise,
           SUM(amountPaise) AS amountPaise
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND eventType = @eventType
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
  `).get({ ...scope, eventType }) || {};
  return {
    count: Number(row.count || 0),
    discountPaise: intPaise(row.discountPaise),
    amountPaise: intPaise(row.amountPaise)
  };
}

function activeBudgets(scope) {
  if (!tableExists("discountBudgets")) return [];
  return db.prepare(`
    SELECT *
    FROM discountBudgets
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
    ORDER BY periodEnd DESC
    LIMIT 20
  `).all(scope).map((row) => ({
    ...row,
    budgetPaise: intPaise(row.budgetPaise),
    spentPaise: intPaise(row.spentPaise),
    usedPercent: row.budgetPaise ? Math.round((intPaise(row.spentPaise) * 10000) / intPaise(row.budgetPaise)) / 100 : 0
  }));
}

function actionPercent(rule = {}) {
  const action = parseJson(rule.action, {});
  return action.type === "percent" ? Number(action.value || 0) : 0;
}

function approvedApprovalExists(scope, ruleId) {
  if (!tableExists("ruleApprovals")) return false;
  const columns = tableColumns("ruleApprovals");
  if (!columns.includes("status")) return false;
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM ruleApprovals
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND ruleId = @ruleId
      AND status = 'approved'
  `).get({ ...scope, ruleId }) || {};
  return Number(row.count || 0) > 0;
}

function activePercentRules(scope) {
  if (!tableExists("discountRules")) return [];
  return db.prepare(`
    SELECT id, name, action, status, createdBy, updatedAt
    FROM discountRules
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
  `).all(scope).map((rule) => ({
    ...rule,
    percent: actionPercent(rule)
  })).filter((rule) => rule.percent > 0);
}

function record(scope, anomaly) {
  return discountAnomaliesRepo.recordAnomaly({
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    detectedAt: Math.floor(Date.now() / 1000),
    ...anomaly
  });
}

function detectUnusualDiscountUsage(scope) {
  const rows = dailyDiscountUsage(scope);
  if (rows.length < 4) return [];
  const totals = rows.map((row) => row.discountPaise);
  const avg = mean(totals);
  const deviation = stddev(totals);
  const threshold = avg + Math.max(deviation * 2, avg);
  return rows
    .filter((row) => row.discountPaise > 0 && row.discountPaise >= threshold && row.discountPaise >= 10000)
    .map((row) => {
      const ratio = avg ? row.discountPaise / avg : 1;
      return record(scope, {
        signature: `usage:${row.businessDate}`,
        anomalyType: "unusual_discount_usage",
        severity: severityFromRatio(ratio),
        title: `Unusual discount usage on ${row.businessDate}`,
        description: "Daily discount spend is materially above the recent branch baseline.",
        evidence: { row, averageDiscountPaise: Math.round(avg), standardDeviationPaise: Math.round(deviation), thresholdPaise: Math.round(threshold), ratio }
      });
    });
}

function detectBudgetSpikes(scope) {
  const anomalies = [];
  const exceeded = eventSummary(scope, "budget_exceeded");
  if (exceeded.count >= 3 || exceeded.discountPaise >= 50000) {
    anomalies.push(record(scope, {
      signature: `budget:exceeded:${scope.fromTs}:${scope.toTs}`,
      anomalyType: "budget_spike",
      severity: exceeded.count >= 10 || exceeded.discountPaise >= 200000 ? "high" : "medium",
      title: "Repeated budget guardrail blocks",
      description: "Budget exceeded events crossed the branch monitoring threshold.",
      evidence: exceeded
    }));
  }
  for (const budget of activeBudgets(scope)) {
    if (budget.budgetPaise > 0 && budget.usedPercent >= 90) {
      anomalies.push(record(scope, {
        signature: `budget:used:${budget.id}`,
        anomalyType: "budget_spike",
        severity: budget.usedPercent >= 110 ? "critical" : "high",
        title: `Discount budget ${budget.usedPercent}% used`,
        description: "Active discount budget usage is near or above the configured limit.",
        evidence: budget
      }));
    }
  }
  return anomalies;
}

function detectMarginRiskOutliers(scope) {
  const margin = eventSummary(scope, "margin_blocked");
  if (margin.count < 3 && margin.discountPaise < 50000) return [];
  return [record(scope, {
    signature: `margin:risk:${scope.fromTs}:${scope.toTs}`,
    anomalyType: "margin_risk_outlier",
    severity: margin.count >= 10 || margin.discountPaise >= 200000 ? "high" : "medium",
    title: "Margin guardrail outlier",
    description: "Margin protection is repeatedly capping or blocking discounts.",
    evidence: margin
  })];
}

function detectApprovalBypass(scope) {
  const branchManagerLimit = roleDiscountLimits.branch_manager || 25;
  return activePercentRules(scope)
    .filter((rule) => rule.percent > branchManagerLimit && !approvedApprovalExists(scope, rule.id))
    .map((rule) => record(scope, {
      signature: `approval:bypass:${rule.id}`,
      anomalyType: "approval_bypass_pattern",
      severity: rule.percent >= 40 ? "high" : "medium",
      title: `Active rule above approval threshold: ${rule.name}`,
      description: "Rule is active above branch-manager discount limit without an approved approval record.",
      evidence: { ruleId: rule.id, ruleName: rule.name, percent: rule.percent, branchManagerLimit, createdBy: rule.createdBy, updatedAt: rule.updatedAt }
    }));
}

export function scanDiscountAnomalies(scope = {}) {
  const current = filters(scope);
  const anomalies = [
    ...detectUnusualDiscountUsage(current),
    ...detectBudgetSpikes(current),
    ...detectMarginRiskOutliers(current),
    ...detectApprovalBypass(current)
  ].filter(Boolean);
  const bySeverity = anomalies.reduce((acc, anomaly) => {
    acc[anomaly.severity] = (acc[anomaly.severity] || 0) + 1;
    return acc;
  }, {});
  return {
    tenantId: current.tenantId,
    branchId: current.branchId,
    from: current.from || null,
    to: current.to || null,
    scannedAt: new Date().toISOString(),
    generated: anomalies.length,
    bySeverity,
    anomalies
  };
}

export const discountAnomalyDetector = {
  scanDiscountAnomalies
};
