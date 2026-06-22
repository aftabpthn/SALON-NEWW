import { db } from "../db.js";

const GRADES = ["excellent", "good", "watch", "poor", "no_data"];

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

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function idFrom(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function epochStart(value) {
  if (!value) return 0;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+05:30`);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : 0;
}

function epochEnd(value) {
  if (!value) return Math.floor(Date.now() / 1000);
  const date = new Date(`${String(value).slice(0, 10)}T23:59:59+05:30`);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : Math.floor(Date.now() / 1000);
}

function rows(sql, params = {}) {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
}

function offerKey({ ruleId, couponId }) {
  if (couponId) return `coupon:${couponId}`;
  if (ruleId) return `rule:${ruleId}`;
  return "unattributed";
}

function ensureOffer(map, key, defaults = {}) {
  if (!map.has(key)) {
    map.set(key, {
      offerKey: key,
      offerType: key.startsWith("coupon:") ? "coupon" : key.startsWith("rule:") ? "rule" : "unattributed",
      ruleId: defaults.ruleId || null,
      couponId: defaults.couponId || null,
      title: defaults.title || "Unattributed discount",
      status: defaults.status || "",
      lifecycleStage: defaults.lifecycleStage || "",
      lifecycleTitle: defaults.lifecycleTitle || "",
      campaignDrafts: 0,
      lastCampaignAt: null,
      targetRevenuePaise: intPaise(defaults.targetRevenuePaise),
      targetApplications: Number(defaults.targetApplications || 0),
      budgetPaise: intPaise(defaults.budgetPaise),
      applications: 0,
      uniqueClientsSet: new Set(),
      repeatClients: 0,
      grossRevenuePaise: 0,
      netRevenuePaise: 0,
      totalDiscountPaise: 0,
      grossMarginPaise: 0,
      manualOutcomeCount: 0,
      auditOutcomeCount: 0,
      budgetBlockedCount: 0,
      marginBlockedCount: 0
    });
  }
  const offer = map.get(key);
  for (const [field, value] of Object.entries(defaults)) {
    if (value !== undefined && value !== null && value !== "" && !offer[field]) offer[field] = value;
  }
  return offer;
}

function seedRules(map, scope) {
  if (!tableExists("discountRules")) return;
  for (const row of rows(`
    SELECT id, name, status
    FROM discountRules
    WHERE tenantId = @tenantId AND branchId = @branchId
  `, scope)) {
    ensureOffer(map, `rule:${row.id}`, {
      ruleId: row.id,
      title: row.name,
      status: row.status
    });
  }
}

function seedCoupons(map, scope) {
  if (!tableExists("discountCoupons")) return;
  for (const row of rows(`
    SELECT id, code, title, status
    FROM discountCoupons
    WHERE tenantId = @tenantId AND branchId = @branchId
  `, scope)) {
    ensureOffer(map, `coupon:${row.id}`, {
      couponId: row.id,
      title: `${row.code} - ${row.title}`,
      status: row.status
    });
  }
}

function seedLifecycle(map, scope) {
  if (!tableExists("happyHoursOfferLifecycle")) return;
  for (const row of rows(`
    SELECT ruleId, couponId, title, stage, budgetPaise, targetRevenuePaise, targetApplications
    FROM happyHoursOfferLifecycle
    WHERE tenantId = @tenantId AND branchId = @branchId
  `, scope)) {
    const ruleId = idFrom(row.ruleId);
    const couponId = idFrom(row.couponId);
    const key = offerKey({ ruleId, couponId });
    ensureOffer(map, key, {
      ruleId,
      couponId,
      title: row.title,
      lifecycleTitle: row.title,
      lifecycleStage: row.stage,
      budgetPaise: row.budgetPaise,
      targetRevenuePaise: row.targetRevenuePaise,
      targetApplications: row.targetApplications
    });
  }
}

function seedCampaignLinks(map, scope) {
  if (!tableExists("happyHoursRuleCampaignLinks")) return;
  for (const row of rows(`
    SELECT ruleId, COUNT(*) AS campaignDrafts, MAX(createdAt) AS lastCampaignAt
    FROM happyHoursRuleCampaignLinks
    WHERE tenantId = @tenantId AND branchId = @branchId
    GROUP BY ruleId
  `, scope)) {
    const key = `rule:${row.ruleId}`;
    const offer = ensureOffer(map, key, { ruleId: row.ruleId });
    offer.campaignDrafts = Number(row.campaignDrafts || 0);
    offer.lastCampaignAt = row.lastCampaignAt || null;
  }
}

function manualOutcomeRows(scope) {
  if (!tableExists("offerRoiEvents")) return [];
  return rows(`
    SELECT ruleId, couponId, clientId, amountPaise, discountPaise, grossMarginPaise, repeatClient, metadata
    FROM offerRoiEvents
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
  `, scope).map((row) => ({
    ...row,
    source: "manual",
    metadata: parseJson(row.metadata, {})
  }));
}

function auditOutcomeRows(scope) {
  if (!tableExists("discountAuditLog")) return [];
  return rows(`
    SELECT ruleId, amountPaise, discountPaise, metadata
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND eventType = 'discount_applied'
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
  `, scope).map((row) => ({
    ...row,
    source: "audit",
    metadata: parseJson(row.metadata, {})
  }));
}

function guardrailRows(scope) {
  if (!tableExists("discountAuditLog")) return [];
  return rows(`
    SELECT ruleId, eventType, metadata
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND eventType IN ('budget_exceeded', 'margin_blocked')
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
  `, scope).map((row) => ({
    ...row,
    metadata: parseJson(row.metadata, {})
  }));
}

function addOutcome(map, row) {
  const ruleId = idFrom(row.ruleId || row.metadata?.ruleId);
  const couponId = idFrom(row.couponId || row.metadata?.couponId);
  const offer = ensureOffer(map, offerKey({ ruleId, couponId }), { ruleId, couponId });
  const clientId = String(row.clientId || row.metadata?.clientId || "").trim();
  offer.applications += 1;
  offer.grossRevenuePaise += intPaise(row.amountPaise);
  offer.totalDiscountPaise += intPaise(row.discountPaise);
  offer.netRevenuePaise += Math.max(0, intPaise(row.amountPaise) - intPaise(row.discountPaise));
  offer.grossMarginPaise += intPaise(row.grossMarginPaise || row.metadata?.grossMarginPaise);
  if (clientId) offer.uniqueClientsSet.add(clientId);
  if (row.repeatClient || row.metadata?.repeatClient) offer.repeatClients += 1;
  if (row.source === "manual") offer.manualOutcomeCount += 1;
  if (row.source === "audit") offer.auditOutcomeCount += 1;
}

function addGuardrail(offer, eventType) {
  if (eventType === "budget_exceeded") offer.budgetBlockedCount += 1;
  if (eventType === "margin_blocked") offer.marginBlockedCount += 1;
}

function applyGuardrails(map, row) {
  const directRuleId = idFrom(row.ruleId || row.metadata?.ruleId);
  const attemptedRules = Array.isArray(row.metadata?.attemptedRules) ? row.metadata.attemptedRules : [];
  const ruleIds = directRuleId ? [directRuleId] : attemptedRules.map(idFrom).filter(Boolean);
  if (!ruleIds.length) return;
  for (const ruleId of ruleIds) {
    addGuardrail(ensureOffer(map, `rule:${ruleId}`, { ruleId }), row.eventType);
  }
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreOffer(offer) {
  if (!offer.applications) {
    return {
      score: 0,
      grade: "no_data",
      recommendation: "Collect applied discount outcomes before scaling this offer.",
      components: { revenue: 0, returnOnDiscount: 0, margin: 0, repeat: 0, guardrail: 0 }
    };
  }
  const returnOnDiscountPercent = offer.totalDiscountPaise ? (offer.netRevenuePaise / offer.totalDiscountPaise) * 100 : 0;
  const marginPercent = offer.netRevenuePaise && offer.grossMarginPaise ? (offer.grossMarginPaise / offer.netRevenuePaise) * 100 : 0;
  const repeatRatePercent = offer.applications ? (offer.repeatClients / offer.applications) * 100 : 0;
  const revenueScore = offer.targetRevenuePaise
    ? Math.min(25, (offer.netRevenuePaise / offer.targetRevenuePaise) * 25)
    : Math.min(25, offer.applications * 2.5);
  const returnScore = Math.min(25, (returnOnDiscountPercent / 400) * 25);
  const marginScore = offer.grossMarginPaise ? Math.min(20, (marginPercent / 35) * 20) : 10;
  const repeatScore = Math.min(15, (repeatRatePercent / 25) * 15);
  const guardrailPenalty = Math.min(15, offer.budgetBlockedCount * 5 + offer.marginBlockedCount * 5);
  const guardrailScore = Math.max(0, 15 - guardrailPenalty);
  const score = clamp(revenueScore + returnScore + marginScore + repeatScore + guardrailScore);
  const grade = score >= 80 ? "excellent" : score >= 60 ? "good" : score >= 40 ? "watch" : "poor";
  const recommendation = grade === "excellent"
    ? "Scale carefully; ROI score, margin and guardrails look strong."
    : grade === "good"
      ? "Keep running and monitor weekly ROI before increasing budget."
      : grade === "watch"
        ? "Tune targeting, cap, or offer timing before scaling."
        : "Pause or redesign unless this is a strategic acquisition offer.";
  return {
    score,
    grade,
    recommendation,
    components: {
      revenue: Math.round(revenueScore),
      returnOnDiscount: Math.round(returnScore),
      margin: Math.round(marginScore),
      repeat: Math.round(repeatScore),
      guardrail: Math.round(guardrailScore)
    }
  };
}

function finalizeOffer(offer) {
  const uniqueClients = offer.uniqueClientsSet.size;
  delete offer.uniqueClientsSet;
  const discountRatePercent = offer.grossRevenuePaise ? Math.round((offer.totalDiscountPaise * 10000) / offer.grossRevenuePaise) / 100 : 0;
  const returnOnDiscountPercent = offer.totalDiscountPaise ? Math.round((offer.netRevenuePaise * 10000) / offer.totalDiscountPaise) / 100 : 0;
  const marginPercent = offer.netRevenuePaise && offer.grossMarginPaise ? Math.round((offer.grossMarginPaise * 10000) / offer.netRevenuePaise) / 100 : 0;
  const repeatRatePercent = offer.applications ? Math.round((offer.repeatClients * 10000) / offer.applications) / 100 : 0;
  const targetAchievementPercent = offer.targetRevenuePaise ? Math.round((offer.netRevenuePaise * 10000) / offer.targetRevenuePaise) / 100 : 0;
  return {
    ...offer,
    uniqueClients,
    discountRatePercent,
    returnOnDiscountPercent,
    marginPercent,
    repeatRatePercent,
    targetAchievementPercent,
    roiScore: scoreOffer(offer)
  };
}

function build(scope = {}) {
  const current = requireScope(scope);
  const params = {
    ...current,
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to)
  };
  const map = new Map();
  seedRules(map, current);
  seedCoupons(map, current);
  seedLifecycle(map, current);
  seedCampaignLinks(map, current);
  manualOutcomeRows(params).forEach((row) => addOutcome(map, row));
  auditOutcomeRows(params).forEach((row) => addOutcome(map, row));
  guardrailRows(params).forEach((row) => applyGuardrails(map, row));

  return [...map.values()]
    .map(finalizeOffer)
    .sort((left, right) => right.roiScore.score - left.roiScore.score || right.netRevenuePaise - left.netRevenuePaise);
}

function filterRows(rowsToFilter, scope = {}) {
  const grade = String(scope.grade || "").trim();
  const offerType = String(scope.offerType || "").trim();
  return rowsToFilter.filter((row) => {
    if (grade && GRADES.includes(grade) && row.roiScore.grade !== grade) return false;
    if (offerType && row.offerType !== offerType) return false;
    return true;
  });
}

export function getOfferRoiScores(scope = {}) {
  const rowsData = filterRows(build(scope), scope);
  const limit = Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 100));
  const offset = Math.max(0, Number.parseInt(scope.offset, 10) || 0);
  return {
    ...requireScope(scope),
    from: scope.from || null,
    to: scope.to || null,
    rows: rowsData.slice(offset, offset + limit),
    limit,
    offset,
    total: rowsData.length
  };
}

export function getOfferRoiSummary(scope = {}) {
  const allRows = build(scope);
  const scoredRows = allRows.filter((row) => row.applications > 0);
  const summary = allRows.reduce((acc, row) => {
    acc.offers += 1;
    acc.applications += row.applications;
    acc.grossRevenuePaise += row.grossRevenuePaise;
    acc.netRevenuePaise += row.netRevenuePaise;
    acc.totalDiscountPaise += row.totalDiscountPaise;
    acc.grossMarginPaise += row.grossMarginPaise;
    acc.budgetBlockedCount += row.budgetBlockedCount;
    acc.marginBlockedCount += row.marginBlockedCount;
    acc.campaignDrafts += row.campaignDrafts;
    acc.scoreTotal += row.roiScore.score;
    acc.byGrade[row.roiScore.grade] = (acc.byGrade[row.roiScore.grade] || 0) + 1;
    return acc;
  }, {
    offers: 0,
    applications: 0,
    grossRevenuePaise: 0,
    netRevenuePaise: 0,
    totalDiscountPaise: 0,
    grossMarginPaise: 0,
    budgetBlockedCount: 0,
    marginBlockedCount: 0,
    campaignDrafts: 0,
    scoreTotal: 0,
    byGrade: {}
  });
  return {
    ...requireScope(scope),
    from: scope.from || null,
    to: scope.to || null,
    summary: {
      ...summary,
      averageScore: summary.offers ? Math.round(summary.scoreTotal / summary.offers) : 0,
      averageScoredOfferScore: scoredRows.length ? Math.round(scoredRows.reduce((sum, row) => sum + row.roiScore.score, 0) / scoredRows.length) : 0,
      discountRatePercent: summary.grossRevenuePaise ? Math.round((summary.totalDiscountPaise * 10000) / summary.grossRevenuePaise) / 100 : 0,
      returnOnDiscountPercent: summary.totalDiscountPaise ? Math.round((summary.netRevenuePaise * 10000) / summary.totalDiscountPaise) / 100 : 0,
      marginPercent: summary.netRevenuePaise && summary.grossMarginPaise ? Math.round((summary.grossMarginPaise * 10000) / summary.netRevenuePaise) / 100 : 0
    },
    topOffers: allRows.filter((row) => row.applications > 0).slice(0, 5),
    watchlist: allRows.filter((row) => ["watch", "poor"].includes(row.roiScore.grade)).slice(0, 5),
    noData: allRows.filter((row) => row.roiScore.grade === "no_data").slice(0, 5),
    note: "ROI score uses discount_applied audit rows, manual ROI outcomes, lifecycle targets, campaign links and guardrail events. Missing GST or margin values are not invented."
  };
}

export function rowsToCsv(rowsData = []) {
  const headers = [
    "offerKey",
    "title",
    "offerType",
    "score",
    "grade",
    "applications",
    "grossRevenuePaise",
    "netRevenuePaise",
    "totalDiscountPaise",
    "returnOnDiscountPercent",
    "marginPercent",
    "repeatRatePercent",
    "budgetBlockedCount",
    "marginBlockedCount",
    "campaignDrafts",
    "recommendation"
  ];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    headers.join(","),
    ...rowsData.map((row) => headers.map((key) => {
      if (key === "score") return escape(row.roiScore.score);
      if (key === "grade") return escape(row.roiScore.grade);
      if (key === "recommendation") return escape(row.roiScore.recommendation);
      return escape(row[key]);
    }).join(","))
  ].join("\n");
}

export const happyHoursRoiScoreRepo = {
  getOfferRoiScores,
  getOfferRoiSummary,
  rowsToCsv
};
