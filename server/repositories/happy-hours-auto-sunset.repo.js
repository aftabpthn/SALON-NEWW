import { db } from "../db.js";

const DEFAULT_POLICY = {
  expirePastEndDate: true,
  pauseCouponsAtUsageLimit: true,
  reviewNoEndDateAfterDays: 30,
  autoApplyExpired: true,
  autoApplyUsageLimit: true,
  autoApplyStale: false
};

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursAutoSunsetPolicies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    policyJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId)
  );

  CREATE INDEX IF NOT EXISTS idx_hhAutoSunsetPolicies_scope
    ON happyHoursAutoSunsetPolicies(tenantId, branchId, status);

  CREATE TABLE IF NOT EXISTS happyHoursAutoSunsetDecisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    signature TEXT NOT NULL,
    offerType TEXT NOT NULL,
    offerId TEXT NOT NULL,
    offerName TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'suggested',
    evidenceJson TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'manual',
    decidedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    appliedAt INTEGER DEFAULT NULL,
    UNIQUE(tenantId, branchId, signature)
  );

  CREATE INDEX IF NOT EXISTS idx_hhAutoSunsetDecisions_scope
    ON happyHoursAutoSunsetDecisions(tenantId, branchId, status, severity, decidedAt);
`);

const policyUpsert = db.prepare(`
  INSERT INTO happyHoursAutoSunsetPolicies (tenantId, branchId, policyJson, status, createdBy)
  VALUES (@tenantId, @branchId, @policyJson, @status, @createdBy)
  ON CONFLICT(tenantId, branchId) DO UPDATE SET
    policyJson = excluded.policyJson,
    status = excluded.status,
    createdBy = COALESCE(excluded.createdBy, happyHoursAutoSunsetPolicies.createdBy),
    updatedAt = strftime('%s','now')
`);

const policyGet = db.prepare(`
  SELECT * FROM happyHoursAutoSunsetPolicies
  WHERE tenantId = @tenantId AND branchId = @branchId
`);

const decisionUpsert = db.prepare(`
  INSERT INTO happyHoursAutoSunsetDecisions (
    tenantId, branchId, signature, offerType, offerId, offerName, action,
    reason, severity, status, evidenceJson, source
  )
  VALUES (
    @tenantId, @branchId, @signature, @offerType, @offerId, @offerName, @action,
    @reason, @severity, 'suggested', @evidenceJson, @source
  )
  ON CONFLICT(tenantId, branchId, signature) DO UPDATE SET
    offerName = excluded.offerName,
    reason = excluded.reason,
    severity = excluded.severity,
    evidenceJson = excluded.evidenceJson,
    source = excluded.source,
    decidedAt = strftime('%s','now')
  WHERE happyHoursAutoSunsetDecisions.status != 'applied'
`);

const decisionBySignature = db.prepare(`
  SELECT * FROM happyHoursAutoSunsetDecisions
  WHERE tenantId = @tenantId AND branchId = @branchId AND signature = @signature
`);

const decisionById = db.prepare(`
  SELECT * FROM happyHoursAutoSunsetDecisions
  WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id
`);

const markDecision = db.prepare(`
  UPDATE happyHoursAutoSunsetDecisions
  SET status = @status,
      appliedAt = CASE WHEN @status = 'applied' THEN strftime('%s','now') ELSE appliedAt END
  WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id
`);

function requireScope(scope = {}) {
  if (!scope.tenantId || !scope.branchId) throw new Error("tenantId and branchId are required");
  return {
    tenantId: String(scope.tenantId),
    branchId: String(scope.branchId)
  };
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parsePolicy(row) {
  if (!row) return { ...DEFAULT_POLICY, status: "active" };
  return {
    ...DEFAULT_POLICY,
    ...parseJson(row.policyJson, {}),
    status: row.status || "active",
    createdBy: row.createdBy || null,
    updatedAt: row.updatedAt || row.createdAt || null
  };
}

function parseDecision(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: parseJson(row.evidenceJson, {})
  };
}

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function tableColumns(tableName) {
  if (!tableExists(tableName)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function hasColumns(tableName, columns) {
  const available = tableColumns(tableName);
  return columns.every((column) => available.has(column));
}

function safeAll(tableName, columns, sql, params, warnings) {
  if (!hasColumns(tableName, columns)) {
    warnings.push(`${tableName} missing required columns`);
    return [];
  }
  try {
    return db.prepare(sql).all(params);
  } catch (error) {
    warnings.push(`${tableName} skipped: ${error.message}`);
    return [];
  }
}

function toDate(value) {
  if (!value) return null;
  const normalized = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function istToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function secondsNow() {
  return Math.floor(Date.now() / 1000);
}

function ageDaysFromSeconds(value) {
  const seconds = Number(value || 0);
  if (!seconds) return 0;
  return Math.floor((secondsNow() - seconds) / 86400);
}

function cleanPolicy(data = {}) {
  const reviewDays = Math.max(1, Math.min(365, Number.parseInt(data.reviewNoEndDateAfterDays, 10) || DEFAULT_POLICY.reviewNoEndDateAfterDays));
  return {
    expirePastEndDate: data.expirePastEndDate !== false,
    pauseCouponsAtUsageLimit: data.pauseCouponsAtUsageLimit !== false,
    reviewNoEndDateAfterDays: reviewDays,
    autoApplyExpired: data.autoApplyExpired !== false,
    autoApplyUsageLimit: data.autoApplyUsageLimit !== false,
    autoApplyStale: data.autoApplyStale === true
  };
}

function decisionPayload(scope, data) {
  return {
    ...requireScope(scope),
    signature: `${data.action}:${data.offerType}:${data.offerId}`,
    offerType: data.offerType,
    offerId: String(data.offerId),
    offerName: String(data.offerName || `${data.offerType} #${data.offerId}`),
    action: data.action,
    reason: data.reason,
    severity: data.severity || "medium",
    evidenceJson: JSON.stringify(data.evidence || {}),
    source: data.source || "manual"
  };
}

function upsertDecision(scope, data) {
  const payload = decisionPayload(scope, data);
  decisionUpsert.run(payload);
  return parseDecision(decisionBySignature.get(payload));
}

function expiredReason(label, endDate, today) {
  return `${label} ended on ${endDate}; current business date is ${today}`;
}

function collectRuleDecisions(scope, policy, today, source, warnings) {
  const rows = safeAll(
    "discountRules",
    ["tenantId", "branchId", "id", "name", "status", "validTo", "createdAt"],
    `
      SELECT id, name, status, validFrom, validTo, createdAt, updatedAt
      FROM discountRules
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND status = 'active'
    `,
    scope,
    warnings
  );

  return rows.flatMap((row) => {
    const decisions = [];
    const validTo = toDate(row.validTo);
    if (policy.expirePastEndDate && validTo && validTo < today) {
      decisions.push({
        offerType: "rule",
        offerId: row.id,
        offerName: row.name,
        action: "expire_rule",
        reason: expiredReason("Discount rule", validTo, today),
        severity: "high",
        source,
        evidence: { validTo, today, currentStatus: row.status }
      });
    }

    const ageDays = ageDaysFromSeconds(row.createdAt);
    if (!validTo && policy.reviewNoEndDateAfterDays > 0 && ageDays >= policy.reviewNoEndDateAfterDays) {
      decisions.push({
        offerType: "rule",
        offerId: row.id,
        offerName: row.name,
        action: "review_stale_offer",
        reason: `Active discount rule has no end date for ${ageDays} days`,
        severity: "medium",
        source,
        evidence: { ageDays, thresholdDays: policy.reviewNoEndDateAfterDays, currentStatus: row.status }
      });
    }
    return decisions;
  });
}

function collectCouponDecisions(scope, policy, today, source, warnings) {
  const rows = safeAll(
    "discountCoupons",
    ["tenantId", "branchId", "id", "code", "title", "status", "validTo", "usageLimit", "usedCount", "createdAt"],
    `
      SELECT id, code, title, status, validFrom, validTo, usageLimit, usedCount, createdAt, updatedAt
      FROM discountCoupons
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND status = 'active'
    `,
    scope,
    warnings
  );

  return rows.flatMap((row) => {
    const decisions = [];
    const validTo = toDate(row.validTo);
    if (policy.expirePastEndDate && validTo && validTo < today) {
      decisions.push({
        offerType: "coupon",
        offerId: row.id,
        offerName: row.code || row.title,
        action: "expire_coupon",
        reason: expiredReason("Coupon", validTo, today),
        severity: "high",
        source,
        evidence: { code: row.code, validTo, today, currentStatus: row.status }
      });
    }

    const usageLimit = Number(row.usageLimit || 0);
    const usedCount = Number(row.usedCount || 0);
    if (policy.pauseCouponsAtUsageLimit && usageLimit > 0 && usedCount >= usageLimit) {
      decisions.push({
        offerType: "coupon",
        offerId: row.id,
        offerName: row.code || row.title,
        action: "pause_coupon",
        reason: `Coupon reached usage limit ${usedCount}/${usageLimit}`,
        severity: "critical",
        source,
        evidence: { code: row.code, usageLimit, usedCount, currentStatus: row.status }
      });
    }

    const ageDays = ageDaysFromSeconds(row.createdAt);
    if (!validTo && policy.reviewNoEndDateAfterDays > 0 && ageDays >= policy.reviewNoEndDateAfterDays) {
      decisions.push({
        offerType: "coupon",
        offerId: row.id,
        offerName: row.code || row.title,
        action: "review_stale_offer",
        reason: `Active coupon has no end date for ${ageDays} days`,
        severity: "medium",
        source,
        evidence: { code: row.code, ageDays, thresholdDays: policy.reviewNoEndDateAfterDays, currentStatus: row.status }
      });
    }

    return decisions;
  });
}

function collectPromotionDecisions(scope, policy, today, source, warnings) {
  const rows = safeAll(
    "promotionCalendar",
    ["tenantId", "branchId", "id", "title", "status", "endDate", "createdAt"],
    `
      SELECT id, title, promoType, status, startDate, endDate, createdAt, updatedAt
      FROM promotionCalendar
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND status IN ('scheduled', 'active')
    `,
    scope,
    warnings
  );

  return rows.flatMap((row) => {
    const decisions = [];
    const endDate = toDate(row.endDate);
    if (policy.expirePastEndDate && endDate && endDate < today) {
      decisions.push({
        offerType: "promotion",
        offerId: row.id,
        offerName: row.title,
        action: "expire_promotion",
        reason: expiredReason("Promotion", endDate, today),
        severity: "high",
        source,
        evidence: { promoType: row.promoType, endDate, today, currentStatus: row.status }
      });
    }

    const ageDays = ageDaysFromSeconds(row.createdAt);
    if (!endDate && policy.reviewNoEndDateAfterDays > 0 && ageDays >= policy.reviewNoEndDateAfterDays) {
      decisions.push({
        offerType: "promotion",
        offerId: row.id,
        offerName: row.title,
        action: "review_stale_offer",
        reason: `Promotion has no end date for ${ageDays} days`,
        severity: "medium",
        source,
        evidence: { ageDays, thresholdDays: policy.reviewNoEndDateAfterDays, currentStatus: row.status }
      });
    }

    return decisions;
  });
}

function shouldAutoApply(action, policy) {
  if (action === "pause_coupon") return Boolean(policy.autoApplyUsageLimit);
  if (action === "review_stale_offer") return Boolean(policy.autoApplyStale);
  return Boolean(policy.autoApplyExpired);
}

export function getPolicy(scope = {}) {
  return parsePolicy(policyGet.get(requireScope(scope)));
}

export function savePolicy(data = {}) {
  const scope = requireScope(data);
  const policy = cleanPolicy(data.policy || data);
  policyUpsert.run({
    ...scope,
    policyJson: JSON.stringify(policy),
    status: data.status === "paused" ? "paused" : "active",
    createdBy: data.createdBy || null
  });
  return getPolicy(scope);
}

export function scan(scope = {}) {
  const current = requireScope(scope);
  const policy = getPolicy(current);
  const warnings = [];
  if (policy.status === "paused") return { policy, today: istToday(), decisions: [], warnings: ["Auto-sunset policy is paused"] };

  const today = toDate(scope.currentDate) || istToday();
  const source = scope.source || "manual";
  const rawDecisions = [
    ...collectRuleDecisions(current, policy, today, source, warnings),
    ...collectCouponDecisions(current, policy, today, source, warnings),
    ...collectPromotionDecisions(current, policy, today, source, warnings)
  ];
  const decisions = rawDecisions.map((decision) => upsertDecision(current, decision));
  return { policy, today, decisions, warnings };
}

export function listDecisions(scope = {}) {
  const current = requireScope(scope);
  const status = scope.status ? String(scope.status) : "";
  const severity = scope.severity ? String(scope.severity) : "";
  const limit = Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 100));
  const offset = Math.max(0, Number.parseInt(scope.offset, 10) || 0);
  const rows = db.prepare(`
    SELECT * FROM happyHoursAutoSunsetDecisions
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      ${status ? "AND status = @status" : ""}
      ${severity ? "AND severity = @severity" : ""}
    ORDER BY CASE status WHEN 'suggested' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
             decidedAt DESC,
             id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...current, status, severity, limit, offset }).map(parseDecision);
  return { rows, limit, offset };
}

export function applyDecision(scope = {}) {
  const current = requireScope(scope);
  const decision = parseDecision(decisionById.get({ ...current, id: Number(scope.id) }));
  if (!decision) return null;
  if (decision.status === "applied") return { ...decision, changes: 0 };

  let changes = 0;
  const id = Number.parseInt(decision.offerId, 10);
  try {
    if (decision.action === "expire_rule" && hasColumns("discountRules", ["tenantId", "branchId", "id", "status", "updatedAt"])) {
      changes = db.prepare(`
        UPDATE discountRules
        SET status = 'expired',
            updatedAt = strftime('%s','now')
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id AND status = 'active'
      `).run({ ...current, id }).changes;
    } else if (decision.action === "expire_coupon" && hasColumns("discountCoupons", ["tenantId", "branchId", "id", "status", "updatedAt"])) {
      changes = db.prepare(`
        UPDATE discountCoupons
        SET status = 'expired',
            updatedAt = strftime('%s','now')
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id AND status = 'active'
      `).run({ ...current, id }).changes;
    } else if (decision.action === "pause_coupon" && hasColumns("discountCoupons", ["tenantId", "branchId", "id", "status", "updatedAt"])) {
      changes = db.prepare(`
        UPDATE discountCoupons
        SET status = 'paused',
            updatedAt = strftime('%s','now')
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id AND status = 'active'
      `).run({ ...current, id }).changes;
    } else if (decision.action === "expire_promotion" && hasColumns("promotionCalendar", ["tenantId", "branchId", "id", "status", "updatedAt"])) {
      changes = db.prepare(`
        UPDATE promotionCalendar
        SET status = 'expired',
            updatedAt = strftime('%s','now')
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id AND status IN ('scheduled', 'active')
      `).run({ ...current, id }).changes;
    } else if (decision.action === "review_stale_offer" && decision.offerType === "rule" && hasColumns("discountRules", ["tenantId", "branchId", "id", "status", "updatedAt"])) {
      changes = db.prepare(`
        UPDATE discountRules
        SET status = 'paused',
            updatedAt = strftime('%s','now')
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id AND status = 'active'
      `).run({ ...current, id }).changes;
    } else if (decision.action === "review_stale_offer" && decision.offerType === "coupon" && hasColumns("discountCoupons", ["tenantId", "branchId", "id", "status", "updatedAt"])) {
      changes = db.prepare(`
        UPDATE discountCoupons
        SET status = 'paused',
            updatedAt = strftime('%s','now')
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id AND status = 'active'
      `).run({ ...current, id }).changes;
    } else if (decision.action === "review_stale_offer" && decision.offerType === "promotion" && hasColumns("promotionCalendar", ["tenantId", "branchId", "id", "status", "updatedAt"])) {
      changes = db.prepare(`
        UPDATE promotionCalendar
        SET status = 'paused',
            updatedAt = strftime('%s','now')
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id AND status IN ('scheduled', 'active')
      `).run({ ...current, id }).changes;
    }
  } catch {
    changes = 0;
  }

  markDecision.run({ ...current, id: decision.id, status: changes > 0 ? "applied" : "skipped" });
  return { ...parseDecision(decisionById.get({ ...current, id: decision.id })), changes };
}

export function runAutoSunset(scope = {}) {
  const current = requireScope(scope);
  const result = scan({ ...current, source: scope.source || "job", currentDate: scope.currentDate });
  if (scope.apply === false) return { ...result, applied: [] };
  const applied = [];
  for (const decision of result.decisions) {
    if (!decision || decision.status !== "suggested") continue;
    if (!shouldAutoApply(decision.action, result.policy)) continue;
    const outcome = applyDecision({ ...current, id: decision.id });
    if (outcome) applied.push(outcome);
  }
  return { ...result, applied };
}

export function listScopes() {
  const scopes = new Map();
  const warnings = [];
  const sources = [
    { table: "discountRules", columns: ["tenantId", "branchId"] },
    { table: "discountCoupons", columns: ["tenantId", "branchId"] },
    { table: "promotionCalendar", columns: ["tenantId", "branchId"] }
  ];
  for (const source of sources) {
    const rows = safeAll(
      source.table,
      source.columns,
      `SELECT DISTINCT tenantId, branchId FROM ${source.table} WHERE tenantId != '' AND branchId != ''`,
      {},
      warnings
    );
    for (const row of rows) {
      scopes.set(`${row.tenantId}:${row.branchId}`, { tenantId: row.tenantId, branchId: row.branchId });
    }
  }
  return Array.from(scopes.values());
}

export const happyHoursAutoSunsetRepo = {
  getPolicy,
  savePolicy,
  scan,
  listDecisions,
  applyDecision,
  runAutoSunset,
  listScopes
};
