import { db } from "../db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MODULES = {
  F1: "RL Dynamic Pricer",
  F2: "Causal Incrementality",
  F3: "CLV-Based Pricing",
  F4: "Competitive Price Intelligence",
  F5: "Digital Twin Simulator",
  F6: "Federated Cross-Salon Learning"
};

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function identifier(name) {
  return `"${String(name).replace(/"/g, "\"\"")}"`;
}

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function columns(tableName) {
  if (!tableExists(tableName)) return [];
  return db.prepare(`PRAGMA table_info(${identifier(tableName)})`).all().map((column) => column.name);
}

function hasColumn(tableName, columnName) {
  return columns(tableName).includes(columnName);
}

function scalar(sql, params = {}, fallback = 0) {
  try {
    const row = db.prepare(sql).get(params);
    return Number(row?.value || 0);
  } catch {
    return fallback;
  }
}

function countRows(tableName, where = "", params = {}) {
  if (!tableExists(tableName)) return 0;
  return scalar(`SELECT COUNT(*) AS value FROM ${identifier(tableName)} ${where}`, params);
}

function distinctCount(tableName, columnName, where = "", params = {}) {
  if (!tableExists(tableName) || !hasColumn(tableName, columnName)) return 0;
  return scalar(`SELECT COUNT(DISTINCT ${identifier(columnName)}) AS value FROM ${identifier(tableName)} ${where}`, params);
}

function rows(sql, params = []) {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
}

function tenantIdSet(tableName, tenantColumn, where = "") {
  if (!tableExists(tableName) || !hasColumn(tableName, tenantColumn)) return new Set();
  return new Set(rows(`
    SELECT DISTINCT ${identifier(tenantColumn)} AS tenantId
    FROM ${identifier(tableName)}
    ${where}
  `).map((row) => String(row.tenantId || "").trim()).filter(Boolean));
}

function normalizeDate(value, { epoch = false } = {}) {
  if (value === null || value === undefined || value === "") return null;
  if (epoch || (Number.isFinite(Number(value)) && String(value).trim() !== "")) {
    const numeric = Number(value);
    const date = new Date((numeric > 100000000000 ? numeric : numeric * 1000));
    if (!Number.isNaN(date.getTime()) && date.getUTCFullYear() >= 2000 && date.getUTCFullYear() < 2100) {
      return date;
    }
  }
  const raw = String(value);
  const parsed = new Date(raw.length <= 10 ? `${raw.slice(0, 10)}T00:00:00Z` : raw);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 2000 || parsed.getUTCFullYear() >= 2100) return null;
  return parsed;
}

function rangeForColumn(tableName, columnName, { epoch = false, where = "", params = {} } = {}) {
  if (!tableExists(tableName) || !hasColumn(tableName, columnName)) return null;
  try {
    const row = db.prepare(`
      SELECT MIN(${identifier(columnName)}) AS minValue,
             MAX(${identifier(columnName)}) AS maxValue
      FROM ${identifier(tableName)}
      ${where}
    `).get(params);
    const minDate = normalizeDate(row?.minValue, { epoch });
    const maxDateRaw = normalizeDate(row?.maxValue, { epoch });
    if (!minDate || !maxDateRaw) return null;
    const now = new Date();
    const maxDate = maxDateRaw > now ? now : maxDateRaw;
    const spanDays = Math.max(0, Math.floor((maxDate.getTime() - minDate.getTime()) / DAY_MS));
    return {
      table: tableName,
      column: columnName,
      minValue: row.minValue,
      maxValue: row.maxValue,
      minIso: minDate.toISOString(),
      maxIso: maxDate.toISOString(),
      spanDays,
      spanMonths: Math.round((spanDays / 30.4375) * 10) / 10
    };
  } catch {
    return null;
  }
}

function bestRange(candidates) {
  return candidates.filter(Boolean).sort((a, b) => b.spanDays - a.spanDays)[0] || {
    spanDays: 0,
    spanMonths: 0,
    minIso: null,
    maxIso: null,
    table: null,
    column: null
  };
}

function statusFromScore(score) {
  if (score >= 100) return "ready";
  if (score >= 60) return "collecting";
  return "blocked";
}

function moduleCard({ code, score, gate, evidence, nextAction, advancedOption, route = null, status = null, details = {} }) {
  return {
    code,
    name: MODULES[code],
    score: Math.max(0, Math.min(100, Math.round(score))),
    status: status || statusFromScore(score),
    gate,
    evidence,
    nextAction,
    advancedOption,
    route,
    details
  };
}

function demandSignalsMetrics() {
  const rows = countRows("demandSignals");
  const tenantCount = distinctCount("demandSignals", "tenantId");
  const branchCount = distinctCount("demandSignals", "branchId");
  const range = bestRange([
    rangeForColumn("demandSignals", "signalDate"),
    rangeForColumn("demandSignals", "capturedAt", { epoch: true })
  ]);
  return { rows, tenantCount, branchCount, range };
}

function causalMetrics(scope) {
  const params = normalizeScope(scope);
  const treatmentResolved = countRows(
    "offerExperiments",
    "WHERE tenantId = @tenantId AND branchId = @branchId AND assignment = 'treatment' AND booked IS NOT NULL",
    params
  );
  const holdoutResolved = countRows(
    "offerExperiments",
    "WHERE tenantId = @tenantId AND branchId = @branchId AND assignment = 'holdout' AND booked IS NOT NULL",
    params
  );
  const totalAssigned = countRows("offerExperiments", "WHERE tenantId = @tenantId AND branchId = @branchId", params);
  return { treatmentResolved, holdoutResolved, totalAssigned };
}

function clientHistoryMetrics(scope) {
  const params = normalizeScope(scope);
  const tenantBranchWhere = "WHERE tenantId = @tenantId AND branchId = @branchId";
  const invoiceRange = bestRange([
    rangeForColumn("invoices", "createdAt", { where: tenantBranchWhere, params }),
    rangeForColumn("invoices", "created_at", { where: tenantBranchWhere, params }),
    rangeForColumn("invoices", "dueDate", { where: tenantBranchWhere, params })
  ]);
  const clientRange = bestRange([
    rangeForColumn("clients", "lastVisitAt", { where: tenantBranchWhere, params }),
    rangeForColumn("clients", "createdAt", { where: tenantBranchWhere, params })
  ]);
  const customerMetricsRange = bestRange([
    rangeForColumn("customer_metrics", "last_visit_date"),
    rangeForColumn("customer_metrics", "updated_at")
  ]);
  const range = bestRange([invoiceRange, clientRange, customerMetricsRange]);
  return {
    range,
    invoices: countRows("invoices", tenantBranchWhere, params),
    clients: countRows("clients", tenantBranchWhere, params)
  };
}

function marketMetrics(scope) {
  const params = normalizeScope(scope);
  const competitors = countRows("competitors", "WHERE tenantId = @tenantId AND branchId = @branchId", params);
  const prices = countRows("competitorPrices", "WHERE tenantId = @tenantId AND branchId = @branchId", params);
  const categories = distinctCount("competitorPrices", "serviceCategory", "WHERE tenantId = @tenantId AND branchId = @branchId", params);
  return { competitors, prices, categories };
}

function simulationMetrics(scope) {
  const history = clientHistoryMetrics(scope);
  const demand = demandSignalsMetrics();
  const elasticity = elasticityMetrics();
  const simulations = countRows("discountSimulations", "WHERE tenantId = @tenantId AND branchId = @branchId", normalizeScope(scope));
  return { history, demand, elasticity, simulations };
}

function elasticityMetrics() {
  const banditArms = countRows("banditArms");
  const discountedDemandRows = countRows("demandSignals", "WHERE activeDiscountPct IS NOT NULL AND activeDiscountPct > 0");
  const discountLevels = distinctCount("demandSignals", "activeDiscountPct", "WHERE activeDiscountPct IS NOT NULL AND activeDiscountPct > 0");
  const available = banditArms > 0 || discountLevels >= 2;
  return {
    available,
    banditArms,
    discountedDemandRows,
    discountLevels,
    note: available
      ? "Elasticity signal exists from bandit arms or multiple discount levels."
      : "No reliable elasticity signal yet; simulation should stay gated."
  };
}

function platformMetrics() {
  const activeSubscriptionSet = tenantIdSet("subscriptions", "tenantId", "WHERE status = 'active'");
  const trialSubscriptionSet = tenantIdSet("subscriptions", "tenantId", "WHERE status = 'trialing'");
  const billingSet = tenantIdSet("invoices", "tenantId");
  const bookingSet = tenantIdSet("appointments", "tenantId");
  const realActiveSet = new Set([...activeSubscriptionSet, ...billingSet, ...bookingSet]);
  const payingSet = new Set([...activeSubscriptionSet, ...billingSet]);
  const activeSubscriptionTenants = activeSubscriptionSet.size;
  const trialSubscriptionTenants = trialSubscriptionSet.size;
  const billingTenants = billingSet.size;
  const bookingTenants = bookingSet.size;
  const demandTenants = distinctCount("demandSignals", "tenantId");
  const activeTenants = countRows("tenants", "WHERE status = 'active'");
  return {
    activeTenants,
    activeSubscriptionTenants,
    trialSubscriptionTenants,
    billingTenants,
    bookingTenants,
    demandTenants,
    realActiveTenantEstimate: realActiveSet.size,
    payingTenantEstimate: payingSet.size,
    seededOrInactiveTenantEstimate: Math.max(0, activeTenants - realActiveSet.size)
  };
}

function tenantActivitySamples() {
  const tenantNames = new Map(rows(`
    SELECT id AS tenantId, name, status, subscriptionStatus
    FROM tenants
    LIMIT 1000
  `).map((row) => [String(row.tenantId), row]));
  const map = new Map();

  function ensure(tenantId) {
    const key = String(tenantId || "").trim();
    if (!key) return null;
    if (!map.has(key)) {
      const tenant = tenantNames.get(key) || {};
      map.set(key, {
        tenantId: key,
        tenantName: tenant.name || key,
        status: tenant.status || "",
        subscriptionStatus: tenant.subscriptionStatus || "",
        invoices: 0,
        appointments: 0,
        demandSignals: 0,
        branches: 0,
        activeSubscription: false,
        trialSubscription: false,
        payingSignal: false,
        realActivityScore: 0
      });
    }
    return map.get(key);
  }

  for (const row of rows(`
    SELECT tenantId, COUNT(*) AS invoices, COUNT(DISTINCT branchId) AS branches
    FROM invoices
    WHERE tenantId IS NOT NULL AND tenantId != ''
    GROUP BY tenantId
    LIMIT 1000
  `)) {
    const item = ensure(row.tenantId);
    if (!item) continue;
    item.invoices = Number(row.invoices || 0);
    item.branches = Math.max(item.branches, Number(row.branches || 0));
  }
  for (const row of rows(`
    SELECT tenantId, COUNT(*) AS appointments, COUNT(DISTINCT branchId) AS branches
    FROM appointments
    WHERE tenantId IS NOT NULL AND tenantId != ''
    GROUP BY tenantId
    LIMIT 1000
  `)) {
    const item = ensure(row.tenantId);
    if (!item) continue;
    item.appointments = Number(row.appointments || 0);
    item.branches = Math.max(item.branches, Number(row.branches || 0));
  }
  for (const row of rows(`
    SELECT tenantId, COUNT(*) AS demandSignals, COUNT(DISTINCT branchId) AS branches
    FROM demandSignals
    WHERE tenantId IS NOT NULL AND tenantId != ''
    GROUP BY tenantId
    LIMIT 1000
  `)) {
    const item = ensure(row.tenantId);
    if (!item) continue;
    item.demandSignals = Number(row.demandSignals || 0);
    item.branches = Math.max(item.branches, Number(row.branches || 0));
  }
  for (const row of rows(`
    SELECT tenantId, status
    FROM subscriptions
    WHERE tenantId IS NOT NULL AND tenantId != ''
  `)) {
    const item = ensure(row.tenantId);
    if (!item) continue;
    item.activeSubscription = row.status === "active";
    item.trialSubscription = row.status === "trialing";
  }

  for (const item of map.values()) {
    item.payingSignal = item.activeSubscription || item.invoices > 0;
    item.realActivityScore = (item.invoices * 3) + (item.appointments * 2) + Math.min(item.demandSignals, 500) + (item.activeSubscription ? 500 : 0);
  }

  return [...map.values()]
    .sort((a, b) => b.realActivityScore - a.realActivityScore)
    .slice(0, 25);
}

function moduleReadiness(scope) {
  const demand = demandSignalsMetrics();
  const causal = causalMetrics(scope);
  const clientHistory = clientHistoryMetrics(scope);
  const market = marketMetrics(scope);
  const simulation = simulationMetrics(scope);
  const platform = platformMetrics();

  const f1Score = Math.min(100, Math.round((demand.range.spanDays / 183) * 70) + Math.min(30, Math.floor(demand.rows / 200)));
  const f2Score = Math.min(100, Math.round((causal.treatmentResolved / 50) * 65) + Math.round((causal.holdoutResolved / 10) * 35));
  const f3Score = Math.min(100, Math.round((clientHistory.range.spanDays / 365) * 75) + Math.min(25, Math.floor(clientHistory.invoices / 20)));
  const f4Score = 100;
  const f5Score = Math.min(100, Math.round((simulation.history.range.spanDays / 90) * 40) + Math.round((simulation.demand.range.spanDays / 90) * 30) + (simulation.elasticity.available ? 30 : 0));
  const f6Score = Math.min(100, Math.round((platform.realActiveTenantEstimate / 50) * 100));
  const f1Status = demand.rows ? (f1Score >= 100 ? "ready" : "collecting") : "blocked";
  const f2Status = f2Score >= 100 ? "ready" : "collecting";
  const f3Status = f3Score >= 100 ? "ready" : (clientHistory.range.spanDays >= 90 ? "collecting" : "premature");
  const f5Status = f5Score >= 100 ? "ready" : (simulation.history.range.spanDays >= 30 && simulation.demand.range.spanDays >= 30 ? "collecting" : "premature");
  const f6Status = f6Score >= 100 ? "ready" : "premature";

  return [
    moduleCard({
      code: "F1",
      score: f1Score,
      status: f1Status,
      gate: "6+ months demandSignals",
      evidence: `${demand.rows} demand rows, ${demand.range.spanMonths} months, ${demand.tenantCount} tenants`,
      nextAction: f1Score >= 100 ? "Start RL bandit only with guarded rollout." : "Keep E6 hourly snapshots running until 183+ days.",
      advancedOption: "Bandit pricer with rules-engine fallback",
      route: "/pricing/yield"
    }),
    moduleCard({
      code: "F2",
      score: f2Score,
      status: f2Status,
      gate: "50 treatment + 10 holdout resolved outcomes",
      evidence: `${causal.treatmentResolved} treatment, ${causal.holdoutResolved} holdout, ${causal.totalAssigned} assigned`,
      nextAction: f2Score >= 100 ? "Enable uplift scoring review." : "Run small holdout experiments on approved offers.",
      advancedOption: "Uplift model + wasted-discount optimizer",
      route: "/pricing/incrementality"
    }),
    moduleCard({
      code: "F3",
      score: f3Score,
      status: f3Status,
      gate: "12+ months client billing history",
      evidence: `${clientHistory.range.spanMonths} months, ${clientHistory.invoices} invoices, ${clientHistory.clients} clients`,
      nextAction: f3Score >= 100 ? "Start CLV scoring as advisory only." : "Collect full-year billing/client history before CLV pricing.",
      advancedOption: "CLV pricer + retention budget allocation"
    }),
    moduleCard({
      code: "F4",
      score: f4Score,
      gate: "Manual competitor prices can start day one",
      evidence: `${market.competitors} competitors, ${market.prices} prices, ${market.categories} categories`,
      nextAction: market.prices > 0 ? "Use market intel to draft off-peak rules." : "Enter competitor prices for top service categories.",
      advancedOption: "Market-aware draft rule suggestions",
      route: "/pricing/market-intelligence"
    }),
    moduleCard({
      code: "F5",
      score: f5Score,
      status: f5Status,
      gate: "90 days invoices + demand + elasticity signal",
      evidence: `${simulation.history.range.spanMonths} months history, ${simulation.demand.range.spanMonths} months demand, elasticity ${simulation.elasticity.available ? "available" : "missing"}`,
      nextAction: f5Score >= 100 ? "Build simulation studio with conservative confidence bands." : "Wait for 90-day demand/history window and elasticity signal, then simulate.",
      advancedOption: "Digital twin simulator + approval-gated launch",
      route: "/discount-rules/simulations",
      details: { elasticity: simulation.elasticity }
    }),
    moduleCard({
      code: "F6",
      score: f6Score,
      status: f6Status,
      gate: "50+ real active/paying tenants",
      evidence: `${platform.realActiveTenantEstimate} real-active estimate, ${platform.payingTenantEstimate} paying estimate, ${platform.activeSubscriptionTenants} active subscriptions`,
      nextAction: f6Score >= 100 ? "Prepare federated weights pipeline." : "Do not build federated learning yet; grow real tenant activity first.",
      advancedOption: "Federated global model + cold-start salon matching"
    })
  ];
}

function chooseNextBest(modules) {
  const ready = modules.filter((item) => item.status === "ready");
  const collecting = modules.filter((item) => item.status === "collecting").sort((a, b) => b.score - a.score);
  const market = modules.find((item) => item.code === "F4");
  if (market && market.status === "ready") {
    return {
      code: "F4_PLUS",
      title: "Upgrade Market Intel into draft-rule suggestions",
      reason: "F4 is useful now and does not need immature ML data.",
      route: market.route,
      priority: 1
    };
  }
  if (ready.length) {
    const best = ready.sort((a, b) => b.score - a.score)[0];
    return {
      code: best.code,
      title: `Start ${best.name}`,
      reason: best.nextAction,
      route: best.route,
      priority: 1
    };
  }
  const nearest = collecting[0] || modules.sort((a, b) => b.score - a.score)[0];
  return {
    code: nearest.code,
    title: `Collect data for ${nearest.name}`,
    reason: nearest.nextAction,
    route: nearest.route,
    priority: 1
  };
}

function buildRoadmap(modules) {
  const byCode = new Map(modules.map((item) => [item.code, item]));
  const choices = [
    {
      code: "F4_PLUS",
      title: "F4 Plus: Market Intel + draft discount rule suggestions",
      trigger: "Use now when ML data gates are not ready.",
      status: byCode.get("F4")?.status || "ready",
      route: "/pricing/market-intelligence"
    },
    {
      code: "F5",
      title: "F5 Digital Twin Simulator",
      trigger: "Start after 90 days invoice/demand data and elasticity are available.",
      status: byCode.get("F5")?.status || "blocked",
      route: "/discount-rules/simulations"
    },
    {
      code: "F1",
      title: "F1 RL Dynamic Pricer",
      trigger: "Start after 6 months demandSignals data.",
      status: byCode.get("F1")?.status || "blocked",
      route: byCode.get("F1")?.route || null
    },
    {
      code: "F3",
      title: "F3 CLV Pricing",
      trigger: "Start after 12 months client billing history.",
      status: byCode.get("F3")?.status || "blocked",
      route: byCode.get("F3")?.route || null
    },
    {
      code: "F6",
      title: "F6 Federated Learning",
      trigger: "Start after 50+ real paying tenants with training samples.",
      status: byCode.get("F6")?.status || "blocked",
      route: byCode.get("F6")?.route || null
    }
  ];
  return choices.map((item, index) => ({ ...item, priority: index + 1 }));
}

export function getLevel6Readiness(scope = {}) {
  const current = normalizeScope(scope);
  const modules = moduleReadiness(current);
  const readinessScore = Math.round(modules.reduce((total, item) => total + item.score, 0) / modules.length);
  const counts = modules.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  return {
    tenantId: current.tenantId,
    branchId: current.branchId,
    generatedAt: new Date().toISOString(),
    readinessScore,
    counts,
    nextBest: chooseNextBest(modules),
    roadmap: buildRoadmap(modules),
    advancedBest: {
      title: "Level 6 Readiness Center + Auto Roadmap Engine",
      reason: "It prevents fake ML, explains blockers, and tells the team what to build next from real data.",
      route: "/pricing/level6-readiness"
    },
    modules,
    platform: platformMetrics(),
    tenantSamples: tenantActivitySamples(),
    source: {
      note: "All signals are read from local SQLite tables. Missing tables count as zero and never block the app.",
      protectedFilesTouched: false
    }
  };
}

export const level6ReadinessRepo = { getLevel6Readiness };
