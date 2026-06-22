import { db } from "../db.js";
import { orgHierarchyRepo } from "./org-hierarchy.repo.js";

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function tableColumns(tableName) {
  if (!tableExists(tableName)) return [];
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function q(column) {
  return `"${String(column).replace(/"/g, '""')}"`;
}

function firstColumn(columns, names) {
  return names.find((name) => columns.includes(name)) || "";
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
  if (!value) return 0;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+05:30`);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : 0;
}

function epochEnd(value) {
  if (!value) return Math.floor(Date.now() / 1000);
  const date = new Date(`${String(value).slice(0, 10)}T23:59:59+05:30`);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : Math.floor(Date.now() / 1000);
}

function normalizeFilters(scope = {}) {
  const current = requireScope(scope);
  return {
    ...current,
    from: scope.from || "",
    to: scope.to || "",
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to),
    filterBranchId: String(scope.filterBranchId || "").trim(),
    regionId: String(scope.regionId || "").trim(),
    limit: Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 50))
  };
}

function auditRows(scope = {}) {
  if (!tableExists("discountAuditLog")) return [];
  const filters = normalizeFilters(scope);
  const where = [
    "tenantId = @tenantId",
    "createdAt >= @fromTs",
    "createdAt <= @toTs"
  ];
  const params = { ...filters };
  if (filters.filterBranchId) {
    where.push("branchId = @filterBranchId");
  }
  return db.prepare(`
    SELECT id, tenantId, branchId, ruleId, eventType, amountPaise, discountPaise,
           gstImpactPaise, metadata, createdAt
    FROM discountAuditLog
    WHERE ${where.join(" AND ")}
    ORDER BY createdAt DESC, id DESC
    LIMIT 10000
  `).all(params).map((row) => ({
    ...row,
    amountPaise: intPaise(row.amountPaise),
    discountPaise: intPaise(row.discountPaise),
    gstImpactPaise: intPaise(row.gstImpactPaise),
    metadata: parseJson(row.metadata, {})
  }));
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
  for (const row of db.prepare(sql).all({ tenantId })) {
    map.set(String(row.branchId), String(row.branchName || row.branchId));
  }
  return map;
}

function activeRulesMap(tenantId) {
  const map = new Map();
  if (!tableExists("discountRules")) return map;
  const rows = db.prepare(`
    SELECT branchId, COUNT(*) AS activeRules
    FROM discountRules
    WHERE tenantId = @tenantId AND status = 'active'
    GROUP BY branchId
  `).all({ tenantId });
  for (const row of rows) map.set(String(row.branchId), Number(row.activeRules || 0));
  return map;
}

function rulesById(tenantId) {
  const map = new Map();
  if (!tableExists("discountRules")) return map;
  const rows = db.prepare(`
    SELECT id, branchId, name, status
    FROM discountRules
    WHERE tenantId = @tenantId
  `).all({ tenantId });
  for (const row of rows) map.set(String(row.id), row);
  return map;
}

function budgetMap(tenantId) {
  const map = new Map();
  if (!tableExists("discountBudgets")) return map;
  const rows = db.prepare(`
    SELECT branchId,
           SUM(budgetPaise) AS budgetPaise,
           SUM(spentPaise) AS spentPaise
    FROM discountBudgets
    WHERE tenantId = @tenantId AND status = 'active'
    GROUP BY branchId
  `).all({ tenantId });
  for (const row of rows) {
    const budgetPaise = intPaise(row.budgetPaise);
    const spentPaise = intPaise(row.spentPaise);
    map.set(String(row.branchId), {
      budgetPaise,
      spentPaise,
      remainingBudgetPaise: Math.max(0, budgetPaise - spentPaise)
    });
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

function emptyBranch(branchId, names, regions, rules, budgets) {
  const budget = budgets.get(branchId) || { budgetPaise: 0, spentPaise: 0, remainingBudgetPaise: 0 };
  const region = regions.get(branchId) || { regionId: "unassigned", regionName: "Unassigned", orgPath: [] };
  return {
    branchId,
    branchName: names.get(branchId) || branchId,
    regionId: region.regionId,
    regionName: region.regionName,
    orgPath: region.orgPath,
    discountEvents: 0,
    grossRevenuePaise: 0,
    netRevenuePaise: 0,
    totalDiscountPaise: 0,
    gstImpactPaise: 0,
    budgetExceededCount: 0,
    marginBlockedCount: 0,
    activeRules: rules.get(branchId) || 0,
    ...budget
  };
}

function addRow(stats, row) {
  if (row.eventType === "discount_applied") {
    stats.discountEvents += 1;
    stats.grossRevenuePaise += intPaise(row.amountPaise);
    stats.totalDiscountPaise += intPaise(row.discountPaise);
    stats.netRevenuePaise += Math.max(0, intPaise(row.amountPaise) - intPaise(row.discountPaise));
    stats.gstImpactPaise += intPaise(row.gstImpactPaise);
  } else if (row.eventType === "budget_exceeded") {
    stats.budgetExceededCount += 1;
  } else if (row.eventType === "margin_blocked") {
    stats.marginBlockedCount += 1;
  }
}

function finalizeBranch(stats) {
  return {
    ...stats,
    avgDiscountPaise: stats.discountEvents ? Math.round(stats.totalDiscountPaise / stats.discountEvents) : 0,
    discountRatePercent: stats.grossRevenuePaise ? Math.round((stats.totalDiscountPaise * 10000) / stats.grossRevenuePaise) / 100 : 0,
    budgetUsedPercent: stats.budgetPaise ? Math.round((stats.spentPaise * 10000) / stats.budgetPaise) / 100 : 0
  };
}

function branchContext(scope) {
  const filters = normalizeFilters(scope);
  const rows = auditRows(filters);
  const names = branchNameMap(filters.tenantId);
  const rules = activeRulesMap(filters.tenantId);
  const budgets = budgetMap(filters.tenantId);
  const branchIds = new Set([
    ...rows.map((row) => String(row.branchId)),
    ...names.keys(),
    ...rules.keys(),
    ...budgets.keys()
  ]);
  if (filters.filterBranchId) branchIds.add(filters.filterBranchId);
  const regions = regionMap(filters.tenantId, [...branchIds]);
  return { filters, rows, names, rules, budgets, regions, branchIds };
}

function regionAllowed(branchId, filters, regions) {
  if (!filters.regionId) return true;
  return regions.get(branchId)?.regionId === filters.regionId;
}

export function branchComparison(scope = {}) {
  const context = branchContext(scope);
  const byBranch = new Map();
  for (const branchId of context.branchIds) {
    if (regionAllowed(branchId, context.filters, context.regions)) {
      byBranch.set(branchId, emptyBranch(branchId, context.names, context.regions, context.rules, context.budgets));
    }
  }
  for (const row of context.rows) {
    const branchId = String(row.branchId);
    if (!byBranch.has(branchId)) continue;
    addRow(byBranch.get(branchId), row);
  }
  const rows = [...byBranch.values()]
    .map(finalizeBranch)
    .sort((left, right) => right.netRevenuePaise - left.netRevenuePaise || right.totalDiscountPaise - left.totalDiscountPaise);
  return { rows, filters: context.filters };
}

export function aggregateDiscountPerformance(scope = {}) {
  const comparison = branchComparison(scope);
  const totals = comparison.rows.reduce((acc, branch) => {
    acc.discountEvents += branch.discountEvents;
    acc.grossRevenuePaise += branch.grossRevenuePaise;
    acc.netRevenuePaise += branch.netRevenuePaise;
    acc.totalDiscountPaise += branch.totalDiscountPaise;
    acc.gstImpactPaise += branch.gstImpactPaise;
    acc.budgetExceededCount += branch.budgetExceededCount;
    acc.marginBlockedCount += branch.marginBlockedCount;
    acc.activeRules += branch.activeRules;
    acc.budgetPaise += branch.budgetPaise;
    acc.spentPaise += branch.spentPaise;
    acc.remainingBudgetPaise += branch.remainingBudgetPaise;
    return acc;
  }, {
    discountEvents: 0,
    grossRevenuePaise: 0,
    netRevenuePaise: 0,
    totalDiscountPaise: 0,
    gstImpactPaise: 0,
    budgetExceededCount: 0,
    marginBlockedCount: 0,
    activeRules: 0,
    budgetPaise: 0,
    spentPaise: 0,
    remainingBudgetPaise: 0
  });
  return {
    ...comparison.filters,
    branchCount: comparison.rows.length,
    ...totals,
    discountRatePercent: totals.grossRevenuePaise ? Math.round((totals.totalDiscountPaise * 10000) / totals.grossRevenuePaise) / 100 : 0,
    budgetUsedPercent: totals.budgetPaise ? Math.round((totals.spentPaise * 10000) / totals.budgetPaise) / 100 : 0,
    regions: regionSummary(scope).rows
  };
}

export function regionSummary(scope = {}) {
  const comparison = branchComparison(scope);
  const byRegion = new Map();
  for (const branch of comparison.rows) {
    const regionId = branch.regionId || "unassigned";
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        regionId,
        regionName: branch.regionName || "Unassigned",
        branchCount: 0,
        discountEvents: 0,
        grossRevenuePaise: 0,
        netRevenuePaise: 0,
        totalDiscountPaise: 0,
        budgetExceededCount: 0,
        marginBlockedCount: 0
      });
    }
    const region = byRegion.get(regionId);
    region.branchCount += 1;
    region.discountEvents += branch.discountEvents;
    region.grossRevenuePaise += branch.grossRevenuePaise;
    region.netRevenuePaise += branch.netRevenuePaise;
    region.totalDiscountPaise += branch.totalDiscountPaise;
    region.budgetExceededCount += branch.budgetExceededCount;
    region.marginBlockedCount += branch.marginBlockedCount;
  }
  const rows = [...byRegion.values()].map((row) => ({
    ...row,
    discountRatePercent: row.grossRevenuePaise ? Math.round((row.totalDiscountPaise * 10000) / row.grossRevenuePaise) / 100 : 0
  })).sort((left, right) => right.netRevenuePaise - left.netRevenuePaise);
  return { rows, filters: comparison.filters };
}

export function topPerformingRules(scope = {}) {
  const context = branchContext(scope);
  const ruleNames = rulesById(context.filters.tenantId);
  const byRule = new Map();
  for (const row of context.rows) {
    const branchId = String(row.branchId);
    if (!regionAllowed(branchId, context.filters, context.regions)) continue;
    if (row.eventType !== "discount_applied") continue;
    const ids = row.ruleId ? [row.ruleId] : Array.isArray(row.metadata?.appliedRules) ? row.metadata.appliedRules : [];
    const ruleIds = ids.length ? ids : ["unattributed"];
    const share = ruleIds.length;
    for (const id of ruleIds) {
      const key = String(id);
      const rule = ruleNames.get(key);
      const item = byRule.get(key) || {
        ruleId: key === "unattributed" ? null : Number(key),
        ruleName: rule?.name || "Unattributed discount",
        status: rule?.status || "",
        branches: new Set(),
        applications: 0,
        grossRevenuePaise: 0,
        netRevenuePaise: 0,
        totalDiscountPaise: 0
      };
      item.branches.add(branchId);
      item.applications += 1;
      item.grossRevenuePaise += Math.round(intPaise(row.amountPaise) / share);
      item.totalDiscountPaise += Math.round(intPaise(row.discountPaise) / share);
      item.netRevenuePaise += Math.round(Math.max(0, intPaise(row.amountPaise) - intPaise(row.discountPaise)) / share);
      byRule.set(key, item);
    }
  }
  const rows = [...byRule.values()].map((row) => ({
    ...row,
    branches: row.branches.size,
    discountRatePercent: row.grossRevenuePaise ? Math.round((row.totalDiscountPaise * 10000) / row.grossRevenuePaise) / 100 : 0
  })).sort((left, right) => right.netRevenuePaise - left.netRevenuePaise).slice(0, context.filters.limit);
  return { rows, filters: context.filters };
}

export function marginImpact(scope = {}) {
  const context = branchContext(scope);
  const byBranch = new Map();
  let marginBlockedCount = 0;
  let marginBlockedPaise = 0;
  let budgetExceededCount = 0;
  let budgetExceededPaise = 0;
  for (const row of context.rows) {
    const branchId = String(row.branchId);
    if (!regionAllowed(branchId, context.filters, context.regions)) continue;
    if (row.eventType !== "margin_blocked" && row.eventType !== "budget_exceeded") continue;
    const branch = byBranch.get(branchId) || emptyBranch(branchId, context.names, context.regions, context.rules, context.budgets);
    if (row.eventType === "margin_blocked") {
      marginBlockedCount += 1;
      marginBlockedPaise += intPaise(row.discountPaise);
      branch.marginBlockedCount += 1;
      branch.marginBlockedPaise = intPaise(branch.marginBlockedPaise) + intPaise(row.discountPaise);
    }
    if (row.eventType === "budget_exceeded") {
      budgetExceededCount += 1;
      budgetExceededPaise += intPaise(row.discountPaise);
      branch.budgetExceededCount += 1;
      branch.budgetExceededPaise = intPaise(branch.budgetExceededPaise) + intPaise(row.discountPaise);
    }
    byBranch.set(branchId, branch);
  }
  return {
    ...context.filters,
    marginBlockedCount,
    marginBlockedPaise,
    budgetExceededCount,
    budgetExceededPaise,
    rows: [...byBranch.values()].sort((left, right) => (intPaise(right.marginBlockedPaise) + intPaise(right.budgetExceededPaise)) - (intPaise(left.marginBlockedPaise) + intPaise(left.budgetExceededPaise)))
  };
}

export const crossBranchAnalyticsRepo = {
  aggregateDiscountPerformance,
  branchComparison,
  regionSummary,
  topPerformingRules,
  marginImpact
};
