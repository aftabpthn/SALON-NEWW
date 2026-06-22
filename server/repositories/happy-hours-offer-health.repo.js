import { db } from "../db.js";
import { happyHoursClientReturnTrackerRepo } from "./happy-hours-client-return-tracker.repo.js";
import { happyHoursRoiScoreRepo } from "./happy-hours-roi-score.repo.js";

const HEALTH_STATUSES = new Set(["healthy", "monitor", "at_risk", "inactive", "no_data"]);

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function tableExists(tableName) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
  } catch {
    return false;
  }
}

function tableColumns(tableName) {
  if (!tableExists(tableName)) return [];
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  } catch {
    return [];
  }
}

function hasColumns(tableName, columns) {
  const available = new Set(tableColumns(tableName));
  return columns.every((column) => available.has(column));
}

function rows(sql, params = {}) {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function todayIso() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

function normalize(scope = {}) {
  const current = requireScope(scope);
  return {
    ...current,
    from: scope.from || "",
    to: scope.to || "",
    healthStatus: HEALTH_STATUSES.has(String(scope.healthStatus || "")) ? String(scope.healthStatus) : "",
    offerType: String(scope.offerType || "").trim(),
    limit: Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
}

function keyParts(offerKey = "") {
  const [type, id] = String(offerKey || "").split(":");
  if (type === "rule" || type === "coupon") return { offerType: type, offerId: id || "" };
  return { offerType: "unattributed", offerId: "" };
}

function ruleMeta(scope) {
  const map = new Map();
  if (!hasColumns("discountRules", ["tenantId", "branchId", "id", "status", "validTo", "updatedAt"])) return map;
  for (const row of rows(`
    SELECT id, status, validFrom, validTo, updatedAt, createdAt
    FROM discountRules
    WHERE tenantId = @tenantId AND branchId = @branchId
  `, scope)) {
    map.set(`rule:${row.id}`, row);
  }
  return map;
}

function couponMeta(scope) {
  const map = new Map();
  if (!hasColumns("discountCoupons", ["tenantId", "branchId", "id", "status", "validTo", "usageLimit", "usedCount", "updatedAt"])) return map;
  for (const row of rows(`
    SELECT id, status, validFrom, validTo, usageLimit, usedCount, updatedAt, createdAt
    FROM discountCoupons
    WHERE tenantId = @tenantId AND branchId = @branchId
  `, scope)) {
    map.set(`coupon:${row.id}`, row);
  }
  return map;
}

function autoSunsetSignals(scope) {
  const map = new Map();
  if (!hasColumns("happyHoursAutoSunsetDecisions", ["tenantId", "branchId", "offerType", "offerId", "status", "severity", "action", "reason", "decidedAt"])) return map;
  for (const row of rows(`
    SELECT offerType, offerId, status, severity, action, reason, decidedAt
    FROM happyHoursAutoSunsetDecisions
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status IN ('suggested', 'skipped')
    ORDER BY decidedAt DESC, id DESC
  `, scope)) {
    const key = `${row.offerType}:${row.offerId}`;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

function lifecycleSignals(scope) {
  const map = new Map();
  if (!hasColumns("happyHoursOfferLifecycle", ["tenantId", "branchId", "ruleId", "couponId", "stage"])) return map;
  for (const row of rows(`
    SELECT ruleId, couponId, stage, budgetPaise, targetRevenuePaise, targetApplications
    FROM happyHoursOfferLifecycle
    WHERE tenantId = @tenantId AND branchId = @branchId
  `, scope)) {
    const key = row.couponId ? `coupon:${row.couponId}` : row.ruleId ? `rule:${row.ruleId}` : "";
    if (key) map.set(key, row);
  }
  return map;
}

function returnMap(scope) {
  const map = new Map();
  const result = happyHoursClientReturnTrackerRepo.offers({
    ...scope,
    limit: 500,
    status: "",
    offerType: "",
    returnWindowDays: scope.returnWindowDays || 30
  });
  for (const row of result.rows || []) map.set(row.offerKey, row);
  return map;
}

function freshnessScore(meta, sunset) {
  if (!meta) return 8;
  if (meta.status === "paused") return 4;
  if (meta.status === "expired" || meta.status === "deleted") return 0;
  if (sunset?.status === "suggested") return sunset.severity === "critical" ? 1 : 3;
  const today = todayIso();
  if (meta.validTo && meta.validTo < today) return 0;
  if (!meta.validTo) return 7;
  return 10;
}

function statusFor(score, offer, meta) {
  if (meta && ["paused", "expired", "deleted"].includes(String(meta.status || ""))) return "inactive";
  if (!offer.applications) return "no_data";
  if (score >= 75) return "healthy";
  if (score >= 55) return "monitor";
  return "at_risk";
}

function recommendation(status, row) {
  if (status === "healthy") return "Keep active; scale with budget and branch monitoring.";
  if (status === "monitor") return "Monitor weekly; tune cap, targeting, or campaign audience.";
  if (status === "inactive") return "Inactive or expired; archive or relaunch only after review.";
  if (status === "no_data") return "Collect applied outcomes before judging health.";
  if (row.marginBlockedCount || row.budgetBlockedCount) return "Guardrails hit; reduce discount or tighten eligibility.";
  if (row.returnRatePercent < 10) return "Weak repeat pull; link campaign follow-up or redesign retention angle.";
  return "Low health; pause, simulate, or rebuild offer.";
}

function healthScore(offer, returns, meta, sunset) {
  const roi = offer.roiScore?.score ? Math.min(25, offer.roiScore.score * 0.25) : 0;
  const margin = offer.marginPercent ? Math.min(20, (offer.marginPercent / 35) * 20) : offer.applications ? 8 : 0;
  const retention = returns?.returnRatePercent ? Math.min(15, (returns.returnRatePercent / 30) * 15) : 0;
  const discountEfficiency = offer.returnOnDiscountPercent ? Math.min(20, (offer.returnOnDiscountPercent / 400) * 20) : 0;
  const guardrailPenalty = Math.min(10, Number(offer.budgetBlockedCount || 0) * 3 + Number(offer.marginBlockedCount || 0) * 4);
  const freshness = freshnessScore(meta, sunset);
  return {
    score: clamp(roi + margin + retention + discountEfficiency + freshness - guardrailPenalty),
    components: {
      roi: Math.round(roi),
      margin: Math.round(margin),
      retention: Math.round(retention),
      discountEfficiency: Math.round(discountEfficiency),
      freshness: Math.round(freshness),
      guardrail: Math.max(0, 10 - guardrailPenalty)
    }
  };
}

function build(scope = {}) {
  const filters = normalize(scope);
  const current = requireScope(filters);
  const roiRows = happyHoursRoiScoreRepo.getOfferRoiScores({ ...filters, limit: 500, offset: 0 }).rows || [];
  const returns = returnMap(filters);
  const meta = new Map([...ruleMeta(current), ...couponMeta(current)]);
  const sunset = autoSunsetSignals(current);
  const lifecycle = lifecycleSignals(current);

  return roiRows.map((offer) => {
    const parts = keyParts(offer.offerKey);
    const returnRow = returns.get(offer.offerKey) || {};
    const offerMeta = meta.get(offer.offerKey) || {};
    const sunsetRow = sunset.get(offer.offerKey) || null;
    const lifecycleRow = lifecycle.get(offer.offerKey) || {};
    const computed = healthScore(offer, returnRow, offerMeta, sunsetRow);
    const healthStatus = statusFor(computed.score, offer, offerMeta);
    return {
      offerKey: offer.offerKey,
      offerType: offer.offerType || parts.offerType,
      offerId: parts.offerId,
      title: offer.title,
      status: offerMeta.status || offer.status || "",
      lifecycleStage: lifecycleRow.stage || offer.lifecycleStage || "",
      applications: Number(offer.applications || 0),
      uniqueClients: Number(offer.uniqueClients || 0),
      netRevenuePaise: intPaise(offer.netRevenuePaise),
      totalDiscountPaise: intPaise(offer.totalDiscountPaise),
      grossMarginPaise: intPaise(offer.grossMarginPaise),
      returnOnDiscountPercent: Number(offer.returnOnDiscountPercent || 0),
      marginPercent: Number(offer.marginPercent || 0),
      repeatRatePercent: Number(offer.repeatRatePercent || 0),
      returnRatePercent: Number(returnRow.returnRatePercent || 0),
      returnedCount: Number(returnRow.returnedCount || 0),
      atRiskReturnCount: Number(returnRow.atRiskCount || 0),
      budgetBlockedCount: Number(offer.budgetBlockedCount || 0),
      marginBlockedCount: Number(offer.marginBlockedCount || 0),
      campaignDrafts: Number(offer.campaignDrafts || 0),
      autoSunsetAction: sunsetRow?.action || "",
      autoSunsetReason: sunsetRow?.reason || "",
      validTo: offerMeta.validTo || null,
      healthScore: computed.score,
      healthStatus,
      components: computed.components,
      recommendation: recommendation(healthStatus, {
        ...offer,
        ...returnRow,
        budgetBlockedCount: Number(offer.budgetBlockedCount || 0),
        marginBlockedCount: Number(offer.marginBlockedCount || 0)
      })
    };
  });
}

function filtered(scope = {}) {
  const filters = normalize(scope);
  const rowsData = build(filters).filter((row) => {
    if (filters.healthStatus && row.healthStatus !== filters.healthStatus) return false;
    if (filters.offerType && row.offerType !== filters.offerType) return false;
    return true;
  }).sort((left, right) => {
    const order = { at_risk: 0, monitor: 1, no_data: 2, inactive: 3, healthy: 4 };
    return (order[left.healthStatus] ?? 9) - (order[right.healthStatus] ?? 9) || left.healthScore - right.healthScore;
  });
  return { filters, rows: rowsData };
}

export function list(scope = {}) {
  const result = filtered(scope);
  const { limit, offset } = result.filters;
  return {
    ...result.filters,
    rows: result.rows.slice(offset, offset + limit),
    total: result.rows.length,
    limit,
    offset
  };
}

export function summary(scope = {}) {
  const filters = normalize(scope);
  const rowsData = build(filters);
  const totals = rowsData.reduce((acc, row) => {
    acc.offers += 1;
    acc.applications += row.applications;
    acc.netRevenuePaise += row.netRevenuePaise;
    acc.totalDiscountPaise += row.totalDiscountPaise;
    acc.grossMarginPaise += row.grossMarginPaise;
    acc.scoreTotal += row.healthScore;
    acc.byStatus[row.healthStatus] = (acc.byStatus[row.healthStatus] || 0) + 1;
    return acc;
  }, {
    offers: 0,
    applications: 0,
    netRevenuePaise: 0,
    totalDiscountPaise: 0,
    grossMarginPaise: 0,
    scoreTotal: 0,
    byStatus: {}
  });
  return {
    ...filters,
    summary: {
      ...totals,
      averageHealthScore: totals.offers ? Math.round(totals.scoreTotal / totals.offers) : 0,
      marginPercent: totals.netRevenuePaise && totals.grossMarginPaise ? Math.round((totals.grossMarginPaise * 10000) / totals.netRevenuePaise) / 100 : 0,
      discountRatePercent: totals.netRevenuePaise ? Math.round((totals.totalDiscountPaise * 10000) / (totals.netRevenuePaise + totals.totalDiscountPaise)) / 100 : 0
    },
    healthy: rowsData.filter((row) => row.healthStatus === "healthy").slice(0, 5),
    watchlist: rowsData.filter((row) => ["at_risk", "monitor"].includes(row.healthStatus)).sort((left, right) => left.healthScore - right.healthScore).slice(0, 8),
    inactive: rowsData.filter((row) => row.healthStatus === "inactive").slice(0, 5),
    note: "Offer Health Score combines ROI, margin, return tracking, guardrails, lifecycle status and auto-sunset signals. Missing optional sources are treated as no signal, not invented values."
  };
}

export const happyHoursOfferHealthRepo = {
  list,
  summary
};
