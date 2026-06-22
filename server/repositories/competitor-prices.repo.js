import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS competitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    competitorName TEXT NOT NULL,
    distance REAL DEFAULT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_competitors_scope ON competitors(tenantId, branchId, competitorName);

  CREATE TABLE IF NOT EXISTS competitorPrices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    competitorId INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
    serviceCategory TEXT NOT NULL,
    pricePaise INTEGER NOT NULL,
    observedDate TEXT NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_compPrices ON competitorPrices(tenantId, branchId, serviceCategory);
  CREATE INDEX IF NOT EXISTS idx_compPrices_competitor ON competitorPrices(tenantId, branchId, competitorId, observedDate);
`);

const VALID_SOURCES = new Set(["manual", "google", "aggregator"]);

const statements = {
  addCompetitor: db.prepare(`
    INSERT INTO competitors (tenantId, branchId, competitorName, distance, source)
    VALUES (@tenantId, @branchId, @competitorName, @distance, @source)
  `),
  getCompetitor: db.prepare(`
    SELECT * FROM competitors
    WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id
  `),
  listCompetitors: db.prepare(`
    SELECT c.*,
           COUNT(p.id) AS priceCount,
           MAX(p.observedDate) AS lastObservedDate
    FROM competitors c
    LEFT JOIN competitorPrices p
      ON p.tenantId = c.tenantId
     AND p.branchId = c.branchId
     AND p.competitorId = c.id
    WHERE c.tenantId = @tenantId
      AND c.branchId = @branchId
    GROUP BY c.id
    ORDER BY c.createdAt DESC, c.id DESC
    LIMIT @limit OFFSET @offset
  `),
  recordPrice: db.prepare(`
    INSERT INTO competitorPrices (
      tenantId, branchId, competitorId, serviceCategory, pricePaise, observedDate
    )
    VALUES (
      @tenantId, @branchId, @competitorId, @serviceCategory, @pricePaise, @observedDate
    )
  `),
  getPrice: db.prepare(`
    SELECT p.*, c.competitorName, c.distance, c.source
    FROM competitorPrices p
    JOIN competitors c
      ON c.tenantId = p.tenantId
     AND c.branchId = p.branchId
     AND c.id = p.competitorId
    WHERE p.tenantId = @tenantId
      AND p.branchId = @branchId
      AND p.id = @id
  `)
};

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function normalizeDate(value) {
  const raw = String(value || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const date = new Date(`${raw}T00:00:00+05:30`);
  if (!Number.isFinite(date.getTime())) throw new Error("valid observedDate is required");
  return raw;
}

function normalizeServiceCategory(value) {
  const serviceCategory = String(value || "").trim().toLowerCase();
  if (!serviceCategory) throw new Error("serviceCategory is required");
  return serviceCategory;
}

function normalizeCompetitor(data = {}) {
  const competitorName = String(data.competitorName || data.name || "").trim();
  if (!competitorName) throw new Error("competitorName is required");
  const source = VALID_SOURCES.has(data.source) ? data.source : "manual";
  const distance = data.distance === undefined || data.distance === null || data.distance === ""
    ? null
    : Math.max(0, Number(data.distance));
  return {
    ...normalizeScope(data),
    id: Number.parseInt(data.id, 10) || null,
    competitorName,
    distance: Number.isFinite(distance) ? distance : null,
    source
  };
}

function priceRowsSql({ serviceCategory }) {
  return `
    SELECT p.*, c.competitorName, c.distance, c.source
    FROM competitorPrices p
    JOIN competitors c
      ON c.tenantId = p.tenantId
     AND c.branchId = p.branchId
     AND c.id = p.competitorId
    WHERE p.tenantId = @tenantId
      AND p.branchId = @branchId
      ${serviceCategory ? "AND p.serviceCategory = @serviceCategory" : ""}
    ORDER BY p.observedDate DESC, p.id DESC
    LIMIT @limit OFFSET @offset
  `;
}

function latestByCompetitor(rows) {
  const latest = new Map();
  for (const row of rows) {
    if (!latest.has(row.competitorId)) latest.set(row.competitorId, row);
  }
  return [...latest.values()];
}

function avg(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((total, value) => total + Number(value || 0), 0) / values.length);
}

export function addCompetitor(data = {}) {
  const payload = normalizeCompetitor(data);
  const result = statements.addCompetitor.run(payload);
  return statements.getCompetitor.get({ ...payload, id: Number(result.lastInsertRowid) });
}

export function listCompetitors(scope = {}) {
  const params = {
    ...normalizeScope(scope),
    limit: Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
  return {
    rows: statements.listCompetitors.all(params),
    limit: params.limit,
    offset: params.offset
  };
}

export function recordPrice(data = {}) {
  const scope = normalizeScope(data);
  const competitorId = Number.parseInt(data.competitorId, 10);
  if (!competitorId) throw new Error("valid competitorId is required");
  const competitor = statements.getCompetitor.get({ ...scope, id: competitorId });
  if (!competitor) throw new Error("competitor not found for this tenant and branch");
  const payload = {
    ...scope,
    competitorId,
    serviceCategory: normalizeServiceCategory(data.serviceCategory),
    pricePaise: intPaise(data.pricePaise),
    observedDate: normalizeDate(data.observedDate)
  };
  if (!payload.pricePaise) throw new Error("pricePaise is required");
  const result = statements.recordPrice.run(payload);
  return statements.getPrice.get({ ...scope, id: Number(result.lastInsertRowid) });
}

export function listPrices(scope = {}) {
  const serviceCategory = scope.serviceCategory ? normalizeServiceCategory(scope.serviceCategory) : "";
  const params = {
    ...normalizeScope(scope),
    serviceCategory,
    limit: Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
  return {
    rows: db.prepare(priceRowsSql({ serviceCategory })).all(params),
    limit: params.limit,
    offset: params.offset
  };
}

export function getMarketRate(scope = {}) {
  const serviceCategory = normalizeServiceCategory(scope.serviceCategory);
  const rows = listPrices({ ...scope, serviceCategory, limit: 500, offset: 0 }).rows;
  const latest = latestByCompetitor(rows);
  const prices = latest.map((row) => Number(row.pricePaise || 0)).filter((value) => value > 0);
  return {
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    serviceCategory,
    avgPaise: avg(prices),
    minPaise: prices.length ? Math.min(...prices) : 0,
    maxPaise: prices.length ? Math.max(...prices) : 0,
    competitorCount: latest.length,
    observationCount: rows.length,
    observations: latest.slice(0, 20)
  };
}

export function getPricePosition(scope = {}) {
  const market = getMarketRate(scope);
  const ourPricePaise = intPaise(scope.ourPricePaise);
  const baseDiscountPercent = Math.min(100, Math.max(0, Number(scope.baseDiscountPercent || 0)));
  if (!market.avgPaise || !ourPricePaise) {
    return {
      ...market,
      ourPricePaise,
      baseDiscountPercent,
      ourEffectivePricePaise: ourPricePaise,
      position: "unknown",
      priceGapPercent: 0,
      recommendedDiscountPercent: baseDiscountPercent,
      note: "Add competitor prices and our service price to calculate market position."
    };
  }
  const ourEffectivePricePaise = Math.round(ourPricePaise * (1 - baseDiscountPercent / 100));
  const priceGapPercent = market.avgPaise ? ((ourEffectivePricePaise - market.avgPaise) / market.avgPaise) * 100 : 0;
  const position = priceGapPercent > 10 ? "above_market" : priceGapPercent < -10 ? "below_market" : "at_market";
  const neededDiscount = Math.ceil((1 - market.avgPaise / ourPricePaise) * 100);
  const recommendedDiscountPercent = position === "above_market"
    ? Math.min(40, Math.max(baseDiscountPercent, neededDiscount))
    : baseDiscountPercent;
  return {
    ...market,
    ourPricePaise,
    baseDiscountPercent,
    ourEffectivePricePaise,
    position,
    priceGapPercent,
    recommendedDiscountPercent,
    note: position === "above_market"
      ? "Market average is lower than our effective price. Consider matching during off-peak hours."
      : "Current effective price is within the manual market band."
  };
}

export const competitorPricesRepo = {
  addCompetitor,
  listCompetitors,
  recordPrice,
  listPrices,
  getMarketRate,
  getPricePosition
};
