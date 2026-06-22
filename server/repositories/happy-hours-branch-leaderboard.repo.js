import { db } from "../db.js";
import { orgHierarchyRepo } from "./org-hierarchy.repo.js";

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

function q(column) {
  return `"${String(column).replace(/"/g, '""')}"`;
}

function firstColumn(columns, names) {
  return names.find((name) => columns.includes(name)) || "";
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

function idFrom(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseJson(value, fallback = {}) {
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

function normalize(scope = {}) {
  const current = requireScope(scope);
  return {
    ...current,
    from: scope.from || "",
    to: scope.to || "",
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to),
    regionId: String(scope.regionId || "").trim(),
    sort: String(scope.sort || "score").trim(),
    limit: Math.min(200, Math.max(1, Number.parseInt(scope.limit, 10) || 50))
  };
}

function branchNameMap(tenantId) {
  const map = new Map();
  const columns = tableColumns("branches");
  if (!columns.length) return map;
  const idCol = firstColumn(columns, ["id", "branchId", "branch_id"]);
  const nameCol = firstColumn(columns, ["name", "branchName", "branch_name"]);
  const tenantCol = firstColumn(columns, ["tenantId", "tenant_id"]);
  if (!idCol) return map;
  const sql = `
    SELECT ${q(idCol)} AS branchId, ${nameCol ? q(nameCol) : q(idCol)} AS branchName
    FROM branches
    ${tenantCol ? `WHERE ${q(tenantCol)} = @tenantId` : ""}
  `;
  for (const row of rows(sql, { tenantId })) {
    map.set(String(row.branchId), String(row.branchName || row.branchId));
  }
  return map;
}

function regionMap(tenantId, branchIds) {
  const map = new Map();
  for (const branchId of branchIds) {
    try {
      const path = orgHierarchyRepo.getBranchOrgPath({ tenantId, branchId });
      const region = path.find((unit) => unit.type === "region") || path[0] || null;
      map.set(branchId, {
        regionId: region ? String(region.id) : "unassigned",
        regionName: region?.name || "Unassigned",
        orgPath: path.map((unit) => ({ id: unit.id, name: unit.name, type: unit.type }))
      });
    } catch {
      map.set(branchId, { regionId: "unassigned", regionName: "Unassigned", orgPath: [] });
    }
  }
  return map;
}

function activeRules(tenantId) {
  const map = new Map();
  if (!hasColumns("discountRules", ["tenantId", "branchId", "status"])) return map;
  for (const row of rows(`
    SELECT branchId, COUNT(*) AS count
    FROM discountRules
    WHERE tenantId = @tenantId AND status = 'active'
    GROUP BY branchId
  `, { tenantId })) {
    map.set(String(row.branchId), Number(row.count || 0));
  }
  return map;
}

function activeCoupons(tenantId) {
  const map = new Map();
  if (!hasColumns("discountCoupons", ["tenantId", "branchId", "status"])) return map;
  for (const row of rows(`
    SELECT branchId, COUNT(*) AS count
    FROM discountCoupons
    WHERE tenantId = @tenantId AND status = 'active'
    GROUP BY branchId
  `, { tenantId })) {
    map.set(String(row.branchId), Number(row.count || 0));
  }
  return map;
}

function ruleNames(tenantId) {
  const map = new Map();
  if (!hasColumns("discountRules", ["tenantId", "id", "name"])) return map;
  for (const row of rows("SELECT id, name FROM discountRules WHERE tenantId = @tenantId", { tenantId })) {
    map.set(`rule:${row.id}`, row.name || `Rule #${row.id}`);
  }
  return map;
}

function couponNames(tenantId) {
  const map = new Map();
  if (!hasColumns("discountCoupons", ["tenantId", "id", "code", "title"])) return map;
  for (const row of rows("SELECT id, code, title FROM discountCoupons WHERE tenantId = @tenantId", { tenantId })) {
    map.set(`coupon:${row.id}`, [row.code, row.title].filter(Boolean).join(" - ") || `Coupon #${row.id}`);
  }
  return map;
}

function offerKey(row = {}) {
  const couponId = idFrom(row.couponId || row.metadata?.couponId);
  const ruleId = idFrom(row.ruleId || row.metadata?.ruleId);
  if (couponId) return `coupon:${couponId}`;
  if (ruleId) return `rule:${ruleId}`;
  return "unattributed";
}

function ensureBranch(map, branchId, context) {
  const key = String(branchId || "");
  if (!key) return null;
  if (!map.has(key)) {
    const region = context.regions.get(key) || { regionId: "unassigned", regionName: "Unassigned", orgPath: [] };
    map.set(key, {
      rank: 0,
      branchId: key,
      branchName: context.names.get(key) || key,
      regionId: region.regionId,
      regionName: region.regionName,
      orgPath: region.orgPath,
      applications: 0,
      uniqueClientsSet: new Set(),
      repeatClients: 0,
      grossRevenuePaise: 0,
      netRevenuePaise: 0,
      totalDiscountPaise: 0,
      grossMarginPaise: 0,
      activeRules: context.rules.get(key) || 0,
      activeCoupons: context.coupons.get(key) || 0,
      guardrailHits: 0,
      budgetBlockedCount: 0,
      marginBlockedCount: 0,
      offerMap: new Map()
    });
  }
  return map.get(key);
}

function ensureOffer(branch, key, title) {
  if (!branch.offerMap.has(key)) {
    branch.offerMap.set(key, {
      offerKey: key,
      title: title || "Unattributed discount",
      applications: 0,
      netRevenuePaise: 0,
      totalDiscountPaise: 0
    });
  }
  return branch.offerMap.get(key);
}

function addOutcome(branch, row, offerTitles) {
  const amountPaise = intPaise(row.amountPaise);
  const discountPaise = intPaise(row.discountPaise);
  const netRevenuePaise = Math.max(0, amountPaise - discountPaise);
  const clientId = String(row.clientId || row.metadata?.clientId || "").trim();
  const key = offerKey(row);
  const offer = ensureOffer(branch, key, offerTitles.get(key));

  branch.applications += 1;
  branch.grossRevenuePaise += amountPaise;
  branch.netRevenuePaise += netRevenuePaise;
  branch.totalDiscountPaise += discountPaise;
  branch.grossMarginPaise += intPaise(row.grossMarginPaise || row.metadata?.grossMarginPaise);
  if (clientId) branch.uniqueClientsSet.add(clientId);
  if (row.repeatClient || row.metadata?.repeatClient) branch.repeatClients += 1;

  offer.applications += 1;
  offer.netRevenuePaise += netRevenuePaise;
  offer.totalDiscountPaise += discountPaise;
}

function roiRows(filters) {
  if (!hasColumns("offerRoiEvents", ["tenantId", "branchId", "createdAt", "amountPaise", "discountPaise"])) return [];
  return rows(`
    SELECT branchId, ruleId, couponId, clientId, amountPaise, discountPaise, grossMarginPaise, repeatClient, metadata
    FROM offerRoiEvents
    WHERE tenantId = @tenantId
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
  `, filters).map((row) => ({ ...row, source: "roi", metadata: parseJson(row.metadata, {}) }));
}

function auditAppliedRows(filters) {
  if (!hasColumns("discountAuditLog", ["tenantId", "branchId", "eventType", "createdAt", "amountPaise", "discountPaise", "metadata"])) return [];
  return rows(`
    SELECT branchId, ruleId, amountPaise, discountPaise, metadata
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND eventType = 'discount_applied'
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
  `, filters).map((row) => ({ ...row, source: "audit", metadata: parseJson(row.metadata, {}) }));
}

function guardrailRows(filters) {
  if (!hasColumns("discountAuditLog", ["tenantId", "branchId", "eventType", "createdAt"])) return [];
  return rows(`
    SELECT branchId, eventType
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND eventType IN ('budget_exceeded', 'margin_blocked')
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
  `, filters);
}

function branchIds(filters, names, rules, coupons, outcomes, guardrails) {
  return new Set([
    ...names.keys(),
    ...rules.keys(),
    ...coupons.keys(),
    ...outcomes.map((row) => String(row.branchId || "")).filter(Boolean),
    ...guardrails.map((row) => String(row.branchId || "")).filter(Boolean),
    filters.branchId
  ]);
}

function branchAllowed(branchId, filters, regions) {
  if (!filters.regionId) return true;
  return regions.get(branchId)?.regionId === filters.regionId;
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function grade(score, applications) {
  if (!applications) return "no_data";
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "watch";
  return "poor";
}

function recommendation(row) {
  if (!row.applications) return "Outcome data collect karo before comparing this branch.";
  if (row.leaderboardGrade === "excellent") return "Scale best offers carefully; branch ROI and margin are strong.";
  if (row.leaderboardGrade === "good") return "Keep running, then replicate winning offer patterns.";
  if (row.leaderboardGrade === "watch") return "Targeting, timing, or cap tune karo before more budget.";
  return "Pause weak offers and review guardrails before scaling.";
}

function topOffer(branch) {
  const rowsData = [...branch.offerMap.values()]
    .sort((left, right) => right.netRevenuePaise - left.netRevenuePaise || right.applications - left.applications);
  return rowsData[0] || { offerKey: "none", title: "No applied offer yet", applications: 0, netRevenuePaise: 0, totalDiscountPaise: 0 };
}

function finalize(branch, topNetRevenuePaise) {
  const uniqueClients = branch.uniqueClientsSet.size;
  const winner = topOffer(branch);
  delete branch.uniqueClientsSet;
  delete branch.offerMap;
  const returnOnDiscountPercent = branch.totalDiscountPaise ? Math.round((branch.netRevenuePaise * 10000) / branch.totalDiscountPaise) / 100 : 0;
  const discountRatePercent = branch.grossRevenuePaise ? Math.round((branch.totalDiscountPaise * 10000) / branch.grossRevenuePaise) / 100 : 0;
  const marginPercent = branch.netRevenuePaise && branch.grossMarginPaise ? Math.round((branch.grossMarginPaise * 10000) / branch.netRevenuePaise) / 100 : 0;
  const repeatRatePercent = branch.applications ? Math.round((branch.repeatClients * 10000) / branch.applications) / 100 : 0;
  const revenueScore = topNetRevenuePaise ? Math.min(25, (branch.netRevenuePaise / topNetRevenuePaise) * 25) : 0;
  const returnScore = Math.min(25, (returnOnDiscountPercent / 400) * 25);
  const marginScore = branch.grossMarginPaise ? Math.min(20, (marginPercent / 35) * 20) : branch.applications ? 10 : 0;
  const repeatScore = Math.min(15, (repeatRatePercent / 25) * 15);
  const guardrailScore = Math.max(0, 15 - Math.min(15, branch.guardrailHits * 3));
  const score = clamp(revenueScore + returnScore + marginScore + repeatScore + guardrailScore);
  const leaderboardGrade = grade(score, branch.applications);
  return {
    ...branch,
    uniqueClients,
    activeOffers: branch.activeRules + branch.activeCoupons,
    topOffer: winner,
    returnOnDiscountPercent,
    discountRatePercent,
    marginPercent,
    repeatRatePercent,
    leaderboardScore: branch.applications ? score : 0,
    leaderboardGrade,
    recommendation: recommendation({ ...branch, leaderboardGrade }),
    components: {
      revenue: Math.round(revenueScore),
      returnOnDiscount: Math.round(returnScore),
      margin: Math.round(marginScore),
      repeat: Math.round(repeatScore),
      guardrail: Math.round(guardrailScore)
    }
  };
}

function build(scope = {}) {
  const filters = normalize(scope);
  const names = branchNameMap(filters.tenantId);
  const rules = activeRules(filters.tenantId);
  const coupons = activeCoupons(filters.tenantId);
  const outcomes = [...roiRows(filters), ...auditAppliedRows(filters)];
  const guardrails = guardrailRows(filters);
  const ids = branchIds(filters, names, rules, coupons, outcomes, guardrails);
  const regions = regionMap(filters.tenantId, [...ids]);
  const context = {
    names,
    rules,
    coupons,
    regions
  };
  const offerTitles = new Map([...ruleNames(filters.tenantId), ...couponNames(filters.tenantId)]);
  const byBranch = new Map();

  for (const branchId of ids) {
    if (branchAllowed(branchId, filters, regions)) ensureBranch(byBranch, branchId, context);
  }

  for (const row of outcomes) {
    const branchId = String(row.branchId || "");
    if (!byBranch.has(branchId)) continue;
    addOutcome(byBranch.get(branchId), row, offerTitles);
  }

  for (const row of guardrails) {
    const branch = byBranch.get(String(row.branchId || ""));
    if (!branch) continue;
    branch.guardrailHits += 1;
    if (row.eventType === "budget_exceeded") branch.budgetBlockedCount += 1;
    if (row.eventType === "margin_blocked") branch.marginBlockedCount += 1;
  }

  const topNetRevenuePaise = Math.max(0, ...[...byBranch.values()].map((branch) => branch.netRevenuePaise));
  return {
    filters,
    rows: [...byBranch.values()].map((branch) => finalize(branch, topNetRevenuePaise))
  };
}

function sortRows(rowsData, sort) {
  const sorted = [...rowsData];
  const comparators = {
    revenue: (left, right) => right.netRevenuePaise - left.netRevenuePaise,
    margin: (left, right) => right.marginPercent - left.marginPercent,
    repeat: (left, right) => right.repeatRatePercent - left.repeatRatePercent,
    guardrails: (left, right) => left.guardrailHits - right.guardrailHits,
    score: (left, right) => right.leaderboardScore - left.leaderboardScore
  };
  sorted.sort(comparators[sort] || comparators.score);
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function leaderboard(scope = {}) {
  const result = build(scope);
  const rowsData = sortRows(result.rows, result.filters.sort).slice(0, result.filters.limit);
  return { ...result.filters, rows: rowsData, total: result.rows.length };
}

export function summary(scope = {}) {
  const result = build(scope);
  const rowsData = sortRows(result.rows, "score");
  const totals = rowsData.reduce((acc, row) => {
    acc.branches += 1;
    acc.applications += row.applications;
    acc.netRevenuePaise += row.netRevenuePaise;
    acc.totalDiscountPaise += row.totalDiscountPaise;
    acc.grossMarginPaise += row.grossMarginPaise;
    acc.guardrailHits += row.guardrailHits;
    acc.scoreTotal += row.leaderboardScore;
    acc.withData += row.applications ? 1 : 0;
    acc.byGrade[row.leaderboardGrade] = (acc.byGrade[row.leaderboardGrade] || 0) + 1;
    return acc;
  }, {
    branches: 0,
    applications: 0,
    netRevenuePaise: 0,
    totalDiscountPaise: 0,
    grossMarginPaise: 0,
    guardrailHits: 0,
    scoreTotal: 0,
    withData: 0,
    byGrade: {}
  });
  return {
    ...result.filters,
    summary: {
      ...totals,
      averageScore: totals.withData ? Math.round(totals.scoreTotal / totals.withData) : 0,
      returnOnDiscountPercent: totals.totalDiscountPaise ? Math.round((totals.netRevenuePaise * 10000) / totals.totalDiscountPaise) / 100 : 0,
      marginPercent: totals.netRevenuePaise && totals.grossMarginPaise ? Math.round((totals.grossMarginPaise * 10000) / totals.netRevenuePaise) / 100 : 0
    },
    topBranches: rowsData.filter((row) => row.applications > 0).slice(0, 5),
    watchlist: rowsData.filter((row) => ["watch", "poor"].includes(row.leaderboardGrade)).slice(0, 5),
    noData: rowsData.filter((row) => row.leaderboardGrade === "no_data").slice(0, 5),
    note: "Branch leaderboard uses offer ROI outcomes, discount audit applications, active rules/coupons and guardrail events. Money values stay in integer paise."
  };
}

export const happyHoursBranchLeaderboardRepo = {
  leaderboard,
  summary
};
