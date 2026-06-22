import { db } from "../db.js";
import { roleDiscountLimits } from "../config/role-discount-limits.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursFraudCases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    signature TEXT NOT NULL,
    guardType TEXT NOT NULL,
    entityType TEXT NOT NULL DEFAULT '',
    entityId TEXT NOT NULL DEFAULT '',
    riskScore INTEGER NOT NULL DEFAULT 0,
    severity TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'open',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    evidenceJson TEXT NOT NULL DEFAULT '{}',
    recommendedActionJson TEXT NOT NULL DEFAULT '{}',
    sourceJson TEXT NOT NULL DEFAULT '{}',
    detectedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    reviewedBy TEXT DEFAULT NULL,
    reviewedAt INTEGER DEFAULT NULL,
    reviewNote TEXT NOT NULL DEFAULT '',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, signature)
  );

  CREATE INDEX IF NOT EXISTS idx_happyHoursFraudCases_scope
    ON happyHoursFraudCases(tenantId, branchId, status, severity, detectedAt);

  CREATE INDEX IF NOT EXISTS idx_happyHoursFraudCases_guard
    ON happyHoursFraudCases(tenantId, branchId, guardType, riskScore);
`);

const statuses = new Set(["open", "investigating", "resolved", "dismissed", "escalated", "blocked"]);
const severities = new Set(["low", "medium", "high", "critical"]);
const guardTypes = new Set([
  "repeat_client_discount_use",
  "staff_manual_override_spike",
  "suspicious_manual_discount",
  "coupon_limit_breach",
  "coupon_reuse_pattern",
  "approval_bypass_attempt",
  "guardrail_pressure",
  "anomaly_escalation"
]);

const statements = {
  upsertCase: db.prepare(`
    INSERT INTO happyHoursFraudCases (
      tenantId, branchId, signature, guardType, entityType, entityId, riskScore,
      severity, status, title, description, evidenceJson, recommendedActionJson,
      sourceJson, detectedAt
    )
    VALUES (
      @tenantId, @branchId, @signature, @guardType, @entityType, @entityId, @riskScore,
      @severity, @status, @title, @description, @evidenceJson, @recommendedActionJson,
      @sourceJson, @detectedAt
    )
    ON CONFLICT(tenantId, branchId, signature)
    DO UPDATE SET
      guardType = excluded.guardType,
      entityType = excluded.entityType,
      entityId = excluded.entityId,
      riskScore = excluded.riskScore,
      severity = excluded.severity,
      title = excluded.title,
      description = excluded.description,
      evidenceJson = excluded.evidenceJson,
      recommendedActionJson = excluded.recommendedActionJson,
      sourceJson = excluded.sourceJson,
      detectedAt = excluded.detectedAt,
      status = CASE
        WHEN happyHoursFraudCases.status IN ('resolved', 'dismissed', 'blocked') THEN happyHoursFraudCases.status
        ELSE excluded.status
      END,
      updatedAt = strftime('%s','now')
  `),
  getBySignature: db.prepare(`
    SELECT * FROM happyHoursFraudCases
    WHERE tenantId = @tenantId AND branchId = @branchId AND signature = @signature
    LIMIT 1
  `),
  getById: db.prepare(`
    SELECT * FROM happyHoursFraudCases
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
    LIMIT 1
  `),
  review: db.prepare(`
    UPDATE happyHoursFraudCases
    SET status = @status,
        reviewedBy = @reviewedBy,
        reviewedAt = strftime('%s','now'),
        reviewNote = @reviewNote,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `)
};

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function tableColumns(tableName) {
  if (!tableExists(tableName)) return [];
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function hasColumns(tableName, columns) {
  const available = new Set(tableColumns(tableName));
  return columns.every((column) => available.has(column));
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

function intValue(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shortText(value, fallback = "", max = 500) {
  const text = String(value ?? fallback).trim();
  return (text || fallback).slice(0, max);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonText(value, fallback = {}) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value);
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

function scopedPeriod(scope = {}) {
  return {
    ...requireScope(scope),
    from: scope.from || "",
    to: scope.to || "",
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to)
  };
}

function normalizeStatus(value, fallback = "open") {
  const status = String(value || fallback).trim();
  return statuses.has(status) ? status : fallback;
}

function severityFromScore(score) {
  if (score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function normalizeSeverity(value, score = 50) {
  const severity = String(value || "").trim();
  return severities.has(severity) ? severity : severityFromScore(score);
}

function normalizeGuardType(value) {
  const guardType = String(value || "").trim();
  return guardTypes.has(guardType) ? guardType : "anomaly_escalation";
}

function parseCase(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: parseJson(row.evidenceJson, {}),
    recommendedAction: parseJson(row.recommendedActionJson, {}),
    source: parseJson(row.sourceJson, {})
  };
}

function normalizeCase(data = {}) {
  const riskScore = Math.max(0, Math.min(100, intValue(data.riskScore, 0)));
  const guardType = normalizeGuardType(data.guardType);
  const title = shortText(data.title, "Fraud guard case", 220);
  return {
    ...requireScope(data),
    signature: shortText(data.signature, `${guardType}:${title}`, 240),
    guardType,
    entityType: shortText(data.entityType, "", 80),
    entityId: shortText(data.entityId, "", 120),
    riskScore,
    severity: normalizeSeverity(data.severity, riskScore),
    status: normalizeStatus(data.status, "open"),
    title,
    description: shortText(data.description, "", 1000),
    evidenceJson: jsonText(data.evidence ?? data.evidenceJson, {}),
    recommendedActionJson: jsonText(data.recommendedAction ?? data.recommendedActionJson, {}),
    sourceJson: jsonText(data.source ?? data.sourceJson, {}),
    detectedAt: intValue(data.detectedAt, Math.floor(Date.now() / 1000))
  };
}

function recordCase(data = {}) {
  const payload = normalizeCase(data);
  statements.upsertCase.run(payload);
  return parseCase(statements.getBySignature.get(payload));
}

function action(decision, ownerRole, nextSteps = []) {
  return { decision, ownerRole, nextSteps };
}

function discountPercent(row = {}) {
  const amount = intPaise(row.amountPaise);
  return amount ? Math.round((intPaise(row.discountPaise) * 10000) / amount) / 100 : 0;
}

function auditRows(scope) {
  if (!hasColumns("discountAuditLog", ["tenantId", "branchId", "eventType", "amountPaise", "discountPaise", "metadata", "createdAt"])) return [];
  return db.prepare(`
    SELECT *
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
    ORDER BY createdAt DESC, id DESC
    LIMIT 1000
  `).all(scope).map((row) => ({
    ...row,
    amountPaise: intPaise(row.amountPaise),
    discountPaise: intPaise(row.discountPaise),
    discountPercent: discountPercent(row),
    metadata: parseJson(row.metadata, {})
  }));
}

function groupEntry(map, key) {
  const existing = map.get(key);
  if (existing) return existing;
  const entry = { count: 0, discountPaise: 0, amountPaise: 0, maxDiscountPercent: 0, invoiceIds: new Set(), ruleIds: new Set(), manualCount: 0 };
  map.set(key, entry);
  return entry;
}

function auditCases(scope, rows) {
  const cases = [];
  const byClient = new Map();
  const byActor = new Map();
  const highManualRows = [];
  const guardrails = { count: 0, discountPaise: 0, eventTypes: {} };

  for (const row of rows) {
    if (row.eventType === "budget_exceeded" || row.eventType === "margin_blocked") {
      guardrails.count += 1;
      guardrails.discountPaise += row.discountPaise;
      guardrails.eventTypes[row.eventType] = (guardrails.eventTypes[row.eventType] || 0) + 1;
    }
    if (row.eventType !== "discount_applied") continue;
    const clientId = shortText(row.metadata?.clientId || row.clientId || "", "", 120);
    const actor = shortText(row.actorUserId || row.metadata?.staffId || row.metadata?.actorUserId || "unknown", "unknown", 120);
    const manualOverride = Boolean(row.metadata?.manualOverride) || String(row.source || "").toLowerCase().includes("manual");
    if (clientId) {
      const entry = groupEntry(byClient, clientId);
      entry.count += 1;
      entry.discountPaise += row.discountPaise;
      entry.amountPaise += row.amountPaise;
      entry.maxDiscountPercent = Math.max(entry.maxDiscountPercent, row.discountPercent);
      if (row.invoiceId || row.metadata?.invoiceId) entry.invoiceIds.add(String(row.invoiceId || row.metadata.invoiceId));
      if (row.ruleId) entry.ruleIds.add(String(row.ruleId));
      if (manualOverride) entry.manualCount += 1;
    }
    if (manualOverride) {
      const entry = groupEntry(byActor, actor);
      entry.count += 1;
      entry.discountPaise += row.discountPaise;
      entry.amountPaise += row.amountPaise;
      entry.maxDiscountPercent = Math.max(entry.maxDiscountPercent, row.discountPercent);
      if (row.invoiceId || row.metadata?.invoiceId) entry.invoiceIds.add(String(row.invoiceId || row.metadata.invoiceId));
      if (row.ruleId) entry.ruleIds.add(String(row.ruleId));
      if (row.discountPercent >= 30 || row.discountPaise >= 75000) highManualRows.push(row);
    }
  }

  for (const [clientId, entry] of byClient.entries()) {
    if (entry.count < 3 && entry.discountPaise < 100000) continue;
    const riskScore = Math.min(100, 35 + entry.count * 8 + Math.round(entry.discountPaise / 25000) + Math.round(entry.maxDiscountPercent / 2));
    cases.push(recordCase({
      ...scope,
      signature: `repeat_client_discount:${clientId}`,
      guardType: "repeat_client_discount_use",
      entityType: "client",
      entityId: clientId,
      riskScore,
      title: `Repeated discount use by client ${clientId}`,
      description: "Same client has repeated discount usage or high discount value in the selected period.",
      evidence: { count: entry.count, discountPaise: entry.discountPaise, amountPaise: entry.amountPaise, maxDiscountPercent: entry.maxDiscountPercent, manualCount: entry.manualCount, invoiceIds: [...entry.invoiceIds], ruleIds: [...entry.ruleIds] },
      recommendedAction: action("review", "branch_manager", ["Check client history before next manual discount.", "Set per-client coupon limits or manager approval if misuse is confirmed."]),
      source: { sourceTable: "discountAuditLog", from: scope.from || null, to: scope.to || null }
    }));
  }

  for (const [actor, entry] of byActor.entries()) {
    if (entry.count < 3 && entry.discountPaise < 75000) continue;
    const riskScore = Math.min(100, 40 + entry.count * 10 + Math.round(entry.discountPaise / 30000) + Math.round(entry.maxDiscountPercent / 2));
    cases.push(recordCase({
      ...scope,
      signature: `staff_manual_override:${actor}`,
      guardType: "staff_manual_override_spike",
      entityType: "staff",
      entityId: actor,
      riskScore,
      title: `Manual discount override spike by ${actor}`,
      description: "Staff/manual actor has repeated manual discount overrides in the selected period.",
      evidence: { count: entry.count, discountPaise: entry.discountPaise, amountPaise: entry.amountPaise, maxDiscountPercent: entry.maxDiscountPercent, invoiceIds: [...entry.invoiceIds], ruleIds: [...entry.ruleIds] },
      recommendedAction: action(riskScore >= 85 ? "block_until_review" : "review", "branch_manager", ["Review POS/manual override notes.", "Move future high manual discounts to approval workflow."]),
      source: { sourceTable: "discountAuditLog", from: scope.from || null, to: scope.to || null }
    }));
  }

  for (const row of highManualRows.slice(0, 50)) {
    const actor = shortText(row.actorUserId || row.metadata?.staffId || "unknown", "unknown", 120);
    const invoiceId = shortText(row.invoiceId || row.metadata?.invoiceId || `audit-${row.id}`, "", 120);
    const riskScore = Math.min(100, 55 + Math.round(row.discountPercent) + Math.round(row.discountPaise / 25000));
    cases.push(recordCase({
      ...scope,
      signature: `suspicious_manual_discount:${invoiceId}:${actor}`,
      guardType: "suspicious_manual_discount",
      entityType: "invoice",
      entityId: invoiceId,
      riskScore,
      title: `High manual discount on ${invoiceId}`,
      description: "Manual discount value or percentage crossed the review threshold.",
      evidence: { auditId: row.id, actorUserId: actor, actorRole: row.actorRole || "", amountPaise: row.amountPaise, discountPaise: row.discountPaise, discountPercent: row.discountPercent, metadata: row.metadata },
      recommendedAction: action("review", "branch_manager", ["Check invoice items, client eligibility and approval note.", "Escalate if the discount was outside policy."]),
      source: { sourceTable: "discountAuditLog", auditId: row.id }
    }));
  }

  if (guardrails.count >= 3 || guardrails.discountPaise >= 100000) {
    const riskScore = Math.min(100, 45 + guardrails.count * 7 + Math.round(guardrails.discountPaise / 50000));
    cases.push(recordCase({
      ...scope,
      signature: `guardrail_pressure:${scope.fromTs}:${scope.toTs}`,
      guardType: "guardrail_pressure",
      entityType: "branch",
      entityId: scope.branchId,
      riskScore,
      title: "Repeated guardrail pressure",
      description: "Budget or margin guardrails are repeatedly being hit by discount attempts.",
      evidence: guardrails,
      recommendedAction: action("tighten_policy", "admin", ["Review active discount rules and budget caps.", "Pause risky offers until margin pressure drops."]),
      source: { sourceTable: "discountAuditLog", eventTypes: Object.keys(guardrails.eventTypes) }
    }));
  }
  return cases;
}

function couponCases(scope) {
  if (!hasColumns("discountCouponUsage", ["tenantId", "branchId", "couponId", "couponCode", "clientId", "discountPaise", "usedAt"])) return [];
  const cases = [];
  const rows = db.prepare(`
    SELECT u.couponId,
           u.couponCode,
           u.clientId,
           COUNT(*) AS uses,
           SUM(u.discountPaise) AS discountPaise,
           MIN(u.usedAt) AS firstUsedAt,
           MAX(u.usedAt) AS lastUsedAt,
           COALESCE(c.perClientLimit, 1) AS perClientLimit
    FROM discountCouponUsage u
    LEFT JOIN discountCoupons c
      ON c.tenantId = u.tenantId AND c.branchId = u.branchId AND c.id = u.couponId
    WHERE u.tenantId = @tenantId
      AND u.branchId = @branchId
      AND u.usedAt >= @fromTs
      AND u.usedAt <= @toTs
      AND COALESCE(u.clientId, '') <> ''
    GROUP BY u.couponId, u.couponCode, u.clientId
  `).all(scope);

  for (const row of rows) {
    const uses = Number(row.uses || 0);
    const perClientLimit = Number(row.perClientLimit || 1);
    if (uses <= Math.max(2, perClientLimit)) continue;
    const riskScore = Math.min(100, 45 + uses * 10 + Math.round(intPaise(row.discountPaise) / 25000));
    cases.push(recordCase({
      ...scope,
      signature: `coupon_reuse:${row.couponId}:${row.clientId}`,
      guardType: "coupon_reuse_pattern",
      entityType: "client",
      entityId: String(row.clientId || ""),
      riskScore,
      title: `${row.couponCode} reused by ${row.clientId}`,
      description: "Client coupon usage crossed the safe per-client threshold.",
      evidence: { couponId: row.couponId, couponCode: row.couponCode, clientId: row.clientId, uses, perClientLimit, discountPaise: intPaise(row.discountPaise), firstUsedAt: row.firstUsedAt, lastUsedAt: row.lastUsedAt },
      recommendedAction: action("review", "branch_manager", ["Confirm whether the client was eligible for every redemption.", "Reduce per-client limit or move coupon to approval-only."]),
      source: { sourceTable: "discountCouponUsage", from: scope.from || null, to: scope.to || null }
    }));
  }

  if (hasColumns("discountCoupons", ["tenantId", "branchId", "id", "code", "usageLimit", "usedCount"])) {
    const breached = db.prepare(`
      SELECT id, code, usageLimit, usedCount, discountType, discountValue
      FROM discountCoupons
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND usageLimit > 0
        AND usedCount > usageLimit
    `).all(scope);
    for (const coupon of breached) {
      cases.push(recordCase({
        ...scope,
        signature: `coupon_limit_breach:${coupon.id}`,
        guardType: "coupon_limit_breach",
        entityType: "coupon",
        entityId: String(coupon.id),
        riskScore: 95,
        title: `${coupon.code} crossed usage limit`,
        description: "Coupon used count is higher than configured usage limit.",
        evidence: coupon,
        recommendedAction: action("block_until_review", "admin", ["Pause this coupon immediately.", "Review recent invoices and campaign source before reactivating."]),
        source: { sourceTable: "discountCoupons" }
      }));
    }
  }
  return cases;
}

function actionPercent(actionValue) {
  const actionValueJson = parseJson(actionValue, {});
  return actionValueJson.type === "percent" ? Number(actionValueJson.value || 0) : 0;
}

function approvedApprovalExists(scope, ruleId) {
  if (!hasColumns("ruleApprovals", ["tenantId", "branchId", "ruleId", "status"])) return false;
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

function approvalBypassCases(scope) {
  if (!hasColumns("discountRules", ["tenantId", "branchId", "id", "name", "action", "status", "createdBy", "updatedAt"])) return [];
  const managerLimit = Number(roleDiscountLimits.branch_manager || 25);
  return db.prepare(`
    SELECT id, name, action, status, createdBy, updatedAt
    FROM discountRules
    WHERE tenantId = @tenantId AND branchId = @branchId AND status = 'active'
  `).all(scope)
    .map((rule) => ({ ...rule, percent: actionPercent(rule.action) }))
    .filter((rule) => rule.percent > managerLimit && !approvedApprovalExists(scope, rule.id))
    .map((rule) => recordCase({
      ...scope,
      signature: `approval_bypass:${rule.id}`,
      guardType: "approval_bypass_attempt",
      entityType: "rule",
      entityId: String(rule.id),
      riskScore: Math.min(100, 60 + Math.round(rule.percent)),
      title: `Active rule above limit: ${rule.name}`,
      description: "Active discount rule is above manager role limit without an approved approval record.",
      evidence: { ruleId: rule.id, ruleName: rule.name, percent: rule.percent, managerLimit, createdBy: rule.createdBy, updatedAt: rule.updatedAt },
      recommendedAction: action("escalate", "regional_head", ["Move rule back to pending approval or pause it.", "Require regional/admin approval before using this discount."]),
      source: { sourceTable: "discountRules", approvalTable: "ruleApprovals" }
    }));
}

function existingAlertCases(scope) {
  const cases = [];
  if (hasColumns("discountAbuseAlerts", ["tenantId", "branchId", "id", "alertType", "severity", "status", "title", "description", "evidenceJson", "detectedAt"])) {
    const alerts = db.prepare(`
      SELECT * FROM discountAbuseAlerts
      WHERE tenantId = @tenantId AND branchId = @branchId AND status IN ('open', 'reviewed')
      ORDER BY detectedAt DESC
      LIMIT 200
    `).all(scope);
    for (const alert of alerts) {
      const scoreBySeverity = { low: 30, medium: 55, high: 75, critical: 90 };
      cases.push(recordCase({
        ...scope,
        signature: `control_tower_abuse:${alert.id}`,
        guardType: normalizeGuardType(alert.alertType),
        entityType: "control_tower_alert",
        entityId: String(alert.id),
        riskScore: scoreBySeverity[alert.severity] || 55,
        severity: alert.severity,
        status: alert.status === "reviewed" ? "investigating" : "open",
        title: alert.title,
        description: alert.description,
        evidence: parseJson(alert.evidenceJson, {}),
        recommendedAction: action("review", "branch_manager", ["Review source alert in Control Tower abuse tab."]),
        source: { sourceTable: "discountAbuseAlerts", alertId: alert.id },
        detectedAt: alert.detectedAt
      }));
    }
  }
  if (hasColumns("discountAnomalies", ["tenantId", "branchId", "id", "anomalyType", "severity", "status", "title", "description", "evidenceJson", "detectedAt"])) {
    const anomalies = db.prepare(`
      SELECT * FROM discountAnomalies
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND status = 'open'
        AND anomalyType IN ('approval_bypass_pattern', 'budget_spike', 'margin_risk_outlier')
      ORDER BY detectedAt DESC
      LIMIT 200
    `).all(scope);
    for (const anomaly of anomalies) {
      const scoreBySeverity = { low: 35, medium: 60, high: 80, critical: 92 };
      cases.push(recordCase({
        ...scope,
        signature: `discount_anomaly:${anomaly.id}`,
        guardType: anomaly.anomalyType === "approval_bypass_pattern" ? "approval_bypass_attempt" : "anomaly_escalation",
        entityType: "anomaly",
        entityId: String(anomaly.id),
        riskScore: scoreBySeverity[anomaly.severity] || 60,
        severity: anomaly.severity,
        title: anomaly.title,
        description: anomaly.description,
        evidence: parseJson(anomaly.evidenceJson, {}),
        recommendedAction: action(anomaly.severity === "critical" ? "block_until_review" : "review", "admin", ["Open anomaly inbox and review evidence.", "Escalate if policy bypass or repeated margin pressure is confirmed."]),
        source: { sourceTable: "discountAnomalies", anomalyId: anomaly.id },
        detectedAt: anomaly.detectedAt
      }));
    }
  }
  return cases;
}

function safeSource(label, work, issues, stats) {
  try {
    return work();
  } catch (error) {
    issues.push({ source: label, message: error.message || "source unavailable" });
    stats[`${label}Error`] = error.message || "source unavailable";
    return [];
  }
}

export function scan(scope = {}) {
  const current = scopedPeriod(scope);
  const sourceIssues = [];
  const sourceStats = {};
  const rows = safeSource("auditRows", () => auditRows(current), sourceIssues, sourceStats);
  sourceStats.auditRows = rows.length;
  const generated = [
    ...safeSource("auditCases", () => auditCases(current, rows), sourceIssues, sourceStats),
    ...safeSource("couponCases", () => couponCases(current), sourceIssues, sourceStats),
    ...safeSource("approvalBypassCases", () => approvalBypassCases(current), sourceIssues, sourceStats),
    ...safeSource("existingAlerts", () => existingAlertCases(current), sourceIssues, sourceStats)
  ].filter(Boolean);
  const cases = [...new Map(generated.map((row) => [row.id, row])).values()];
  const bySeverity = cases.reduce((acc, row) => {
    acc[row.severity] = (acc[row.severity] || 0) + 1;
    return acc;
  }, {});
  return {
    tenantId: current.tenantId,
    branchId: current.branchId,
    from: current.from || null,
    to: current.to || null,
    scannedAt: new Date().toISOString(),
    generated: cases.length,
    bySeverity,
    sourceStats,
    sourceIssues,
    cases
  };
}

function listSql({ status, severity, guardType }) {
  return `
    SELECT * FROM happyHoursFraudCases
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      ${status ? "AND status = @status" : ""}
      ${severity ? "AND severity = @severity" : ""}
      ${guardType ? "AND guardType = @guardType" : ""}
    ORDER BY riskScore DESC, detectedAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `;
}

export function listCases(scope = {}) {
  const current = requireScope(scope);
  const status = scope.status ? normalizeStatus(scope.status) : "";
  const severity = scope.severity ? normalizeSeverity(scope.severity) : "";
  const guardType = scope.guardType ? normalizeGuardType(scope.guardType) : "";
  const limit = Math.min(500, Math.max(1, intValue(scope.limit, 100)));
  const offset = Math.max(0, intValue(scope.offset, 0));
  return {
    rows: db.prepare(listSql({ status, severity, guardType })).all({ ...current, status, severity, guardType, limit, offset }).map(parseCase),
    limit,
    offset
  };
}

export function reviewCase(data = {}) {
  const current = requireScope(data);
  const id = intValue(data.id, 0);
  if (!id) throw new Error("valid fraud case id is required");
  statements.review.run({
    ...current,
    id,
    status: normalizeStatus(data.status, "investigating"),
    reviewedBy: data.reviewedBy || null,
    reviewNote: shortText(data.reviewNote || data.note, "", 800)
  });
  return parseCase(statements.getById.get({ ...current, id }));
}

export function summary(scope = {}) {
  const current = requireScope(scope);
  const rows = listCases({ ...current, limit: 500 }).rows;
  const result = {
    ...current,
    totalCases: rows.length,
    openCases: 0,
    criticalCases: 0,
    highRiskCases: 0,
    averageRiskScore: 0,
    totalAtRiskDiscountPaise: 0,
    byStatus: {},
    bySeverity: {},
    byGuardType: {},
    topCases: rows.slice(0, 5),
    generatedAt: new Date().toISOString()
  };
  let scoreTotal = 0;
  for (const row of rows) {
    result.byStatus[row.status] = (result.byStatus[row.status] || 0) + 1;
    result.bySeverity[row.severity] = (result.bySeverity[row.severity] || 0) + 1;
    result.byGuardType[row.guardType] = (result.byGuardType[row.guardType] || 0) + 1;
    if (["open", "escalated", "investigating"].includes(row.status)) result.openCases += 1;
    if (row.severity === "critical") result.criticalCases += 1;
    if (row.riskScore >= 70) result.highRiskCases += 1;
    scoreTotal += Number(row.riskScore || 0);
    result.totalAtRiskDiscountPaise += intPaise(row.evidence?.discountPaise);
  }
  result.averageRiskScore = rows.length ? Math.round(scoreTotal / rows.length) : 0;
  return result;
}

export function assessContext(data = {}) {
  const current = requireScope(data);
  const identifiers = [
    ["client", shortText(data.clientId, "", 120)],
    ["staff", shortText(data.staffId || data.actorUserId, "", 120)],
    ["coupon", shortText(data.couponId || data.couponCode, "", 120)],
    ["rule", shortText(data.ruleId, "", 120)]
  ].filter(([, value]) => value);
  const matchedCases = [];
  for (const [entityType, entityId] of identifiers) {
    matchedCases.push(...db.prepare(`
      SELECT * FROM happyHoursFraudCases
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND entityType = @entityType
        AND entityId = @entityId
        AND status IN ('open', 'investigating', 'escalated')
      ORDER BY riskScore DESC, detectedAt DESC
      LIMIT 20
    `).all({ ...current, entityType, entityId }).map(parseCase));
  }
  const requestedDiscountPaise = intPaise(data.discountPaise);
  const requestedAmountPaise = intPaise(data.cartTotalPaise ?? data.amountPaise);
  const requestedDiscountPercent = requestedAmountPaise ? Math.round((requestedDiscountPaise * 10000) / requestedAmountPaise) / 100 : 0;
  const maxExistingRisk = matchedCases.reduce((max, row) => Math.max(max, row.riskScore || 0), 0);
  const requestedRisk = requestedDiscountPercent >= 30 || requestedDiscountPaise >= 75000 ? 20 : 0;
  const riskScore = Math.min(100, maxExistingRisk + requestedRisk);
  const decision = riskScore >= 85 ? "block_until_review" : riskScore >= 60 ? "manager_review" : "allow";
  return {
    ...current,
    decision,
    riskScore,
    requestedDiscountPercent,
    matchedCases,
    recommendation: decision === "allow" ? "No active fraud guard case matched this context." : "Require manager/admin review before allowing this discount."
  };
}

export const happyHoursFraudGuardRepo = {
  scan,
  summary,
  listCases,
  reviewCase,
  assessContext
};
