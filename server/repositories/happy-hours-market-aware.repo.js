import { competitorPricesRepo } from "./competitor-prices.repo.js";
import { db } from "../db.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursMarketAwareSuggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    serviceCategory TEXT NOT NULL DEFAULT 'default',
    signalDate TEXT NOT NULL,
    dayOfWeek TEXT NOT NULL DEFAULT '',
    hourSlot INTEGER NOT NULL DEFAULT 0,
    ourPricePaise INTEGER NOT NULL DEFAULT 0,
    baseDiscountPercent REAL NOT NULL DEFAULT 0,
    marketAvgPaise INTEGER NOT NULL DEFAULT 0,
    marketMinPaise INTEGER NOT NULL DEFAULT 0,
    marketMaxPaise INTEGER NOT NULL DEFAULT 0,
    competitorCount INTEGER NOT NULL DEFAULT 0,
    observationCount INTEGER NOT NULL DEFAULT 0,
    occupancyRate REAL NOT NULL DEFAULT 0,
    priceGapPercent REAL NOT NULL DEFAULT 0,
    marketPosition TEXT NOT NULL DEFAULT 'unknown',
    campaignAngle TEXT NOT NULL DEFAULT 'collect_market_prices',
    suggestedDiscountPercent INTEGER NOT NULL DEFAULT 0,
    expectedDiscountPaise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'suggested',
    reasons TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_marketAwareSuggestions_scope
    ON happyHoursMarketAwareSuggestions(tenantId, branchId, status, serviceCategory, createdAt);
`);

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function cleanCategory(value) {
  return String(value || "default").trim().toLowerCase() || "default";
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function pct(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function slot(input = {}) {
  const date = input.signalDate ? new Date(`${String(input.signalDate).slice(0, 10)}T00:00:00+05:30`) : new Date();
  const parts = happyHoursEngine.getISTComponents(date);
  return {
    signalDate: String(input.signalDate || parts.nowDate).slice(0, 10),
    dayOfWeek: String(input.dayOfWeek || parts.nowDay).slice(0, 3).toLowerCase(),
    hourSlot: Math.max(0, Math.min(23, Number.parseInt(input.hourSlot ?? parts.nowTime.slice(0, 2), 10) || 0))
  };
}

function tableExists(tableName) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @tableName").get({ tableName }));
  } catch {
    return false;
  }
}

function demandContext(scope = {}) {
  if (!tableExists("demandSignals")) return { occupancyRate: 0, sampleCount: 0 };
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS sampleCount,
             ROUND(AVG(occupancyRate), 4) AS occupancyRate
      FROM demandSignals
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND dayOfWeek = @dayOfWeek
        AND hourSlot = @hourSlot
    `).get(scope);
    return {
      occupancyRate: Number(row?.occupancyRate || 0),
      sampleCount: Number(row?.sampleCount || 0)
    };
  } catch {
    return { occupancyRate: 0, sampleCount: 0 };
  }
}

function marketPosition(input = {}) {
  const current = normalizeScope(input);
  try {
    return competitorPricesRepo.getPricePosition({
      ...current,
      serviceCategory: cleanCategory(input.serviceCategory),
      ourPricePaise: intPaise(input.ourPricePaise),
      baseDiscountPercent: pct(input.baseDiscountPercent)
    });
  } catch {
    return {
      ...current,
      serviceCategory: cleanCategory(input.serviceCategory),
      avgPaise: 0,
      minPaise: 0,
      maxPaise: 0,
      competitorCount: 0,
      observationCount: 0,
      ourPricePaise: intPaise(input.ourPricePaise),
      baseDiscountPercent: pct(input.baseDiscountPercent),
      ourEffectivePricePaise: intPaise(input.ourPricePaise),
      position: "unknown",
      priceGapPercent: 0,
      recommendedDiscountPercent: pct(input.baseDiscountPercent),
      note: "Add competitor prices and our service price to calculate market position."
    };
  }
}

function capForOccupancy(occupancyRate, input = {}) {
  const maxDiscountPercent = pct(input.maxDiscountPercent, 30);
  if (occupancyRate >= 0.8) return Math.min(maxDiscountPercent, 8);
  if (occupancyRate >= 0.6) return Math.min(maxDiscountPercent, 15);
  if (occupancyRate > 0 && occupancyRate < 0.4) return Math.min(maxDiscountPercent, 30);
  return Math.min(maxDiscountPercent, 22);
}

function buildSuggestion(input = {}, mode = "recommended") {
  const current = normalizeScope(input);
  const currentSlot = slot(input);
  const demand = demandContext({ ...current, ...currentSlot });
  const position = marketPosition(input);
  const ourPricePaise = intPaise(input.ourPricePaise);
  const baseDiscountPercent = pct(input.baseDiscountPercent);
  const cap = capForOccupancy(demand.occupancyRate, input);
  const reasons = [position.note];
  let campaignAngle = "collect_market_prices";
  let suggestedDiscountPercent = baseDiscountPercent;
  let marketPositionLabel = position.position || "unknown";
  let status = "collecting";

  if (!ourPricePaise || !position.competitorCount) {
    suggestedDiscountPercent = baseDiscountPercent;
    reasons.push("Competitor samples ya ourPricePaise missing hai; suggestion review-only hai.");
  } else if (position.position === "above_market") {
    status = "ready";
    campaignAngle = demand.occupancyRate >= 0.8 ? "protect_peak_margin" : "market_match_slow_hour";
    suggestedDiscountPercent = Math.min(cap, Math.max(baseDiscountPercent, Math.round(Number(position.recommendedDiscountPercent || 0))));
    reasons.push("Our price competitor average se higher hai; slow-hour market match useful ho sakta hai.");
  } else if (position.position === "at_market") {
    status = "ready";
    campaignAngle = demand.occupancyRate && demand.occupancyRate < 0.45 ? "small_market_nudge" : "hold_market_price";
    suggestedDiscountPercent = demand.occupancyRate && demand.occupancyRate < 0.45 ? Math.min(cap, Math.max(baseDiscountPercent, 5)) : baseDiscountPercent;
    reasons.push("Our price market band ke andar hai; deep discount avoid karo.");
  } else if (position.position === "below_market") {
    status = "ready";
    campaignAngle = "protect_price_power";
    suggestedDiscountPercent = mode === "aggressive" ? Math.min(5, cap) : 0;
    reasons.push("Our price market se already lower hai; margin protect karna better hai.");
  }

  if (mode === "conservative") suggestedDiscountPercent = Math.min(suggestedDiscountPercent, Math.max(baseDiscountPercent, 8));
  if (mode === "aggressive" && position.position === "above_market") suggestedDiscountPercent = Math.min(cap, suggestedDiscountPercent + 5);
  if (demand.occupancyRate >= 0.8) reasons.push("Occupancy high hai; discount cap low rakha gaya.");
  if (demand.occupancyRate > 0 && demand.occupancyRate < 0.4) reasons.push("Occupancy low hai; market match offer allowed hai.");

  return {
    ...current,
    ...currentSlot,
    serviceCategory: cleanCategory(input.serviceCategory),
    ourPricePaise,
    baseDiscountPercent,
    marketAvgPaise: intPaise(position.avgPaise),
    marketMinPaise: intPaise(position.minPaise),
    marketMaxPaise: intPaise(position.maxPaise),
    competitorCount: Number(position.competitorCount || 0),
    observationCount: Number(position.observationCount || 0),
    occupancyRate: demand.occupancyRate,
    sampleCount: demand.sampleCount,
    priceGapPercent: Math.round(Number(position.priceGapPercent || 0) * 10) / 10,
    marketPosition: marketPositionLabel,
    campaignAngle,
    suggestedDiscountPercent: Math.round(suggestedDiscountPercent),
    expectedDiscountPaise: Math.round(ourPricePaise * (Math.round(suggestedDiscountPercent) / 100)),
    status,
    mode,
    reasons
  };
}

export function evaluate(scope = {}) {
  const best = buildSuggestion(scope, "recommended");
  const rows = [
    buildSuggestion(scope, "conservative"),
    best,
    buildSuggestion(scope, "aggressive")
  ];
  return {
    status: best.status,
    best,
    rows,
    summary: {
      competitorCount: best.competitorCount,
      observationCount: best.observationCount,
      marketAvgPaise: best.marketAvgPaise,
      priceGapPercent: best.priceGapPercent,
      position: best.marketPosition,
      maxDiscountPercent: Math.max(...rows.map((row) => Number(row.suggestedDiscountPercent || 0)))
    }
  };
}

export function saveSuggestion(scope = {}) {
  const row = evaluate(scope).best;
  const payload = {
    ...row,
    reasons: JSON.stringify(row.reasons || []),
    status: "suggested"
  };
  const result = db.prepare(`
    INSERT INTO happyHoursMarketAwareSuggestions (
      tenantId, branchId, serviceCategory, signalDate, dayOfWeek, hourSlot,
      ourPricePaise, baseDiscountPercent, marketAvgPaise, marketMinPaise,
      marketMaxPaise, competitorCount, observationCount, occupancyRate,
      priceGapPercent, marketPosition, campaignAngle, suggestedDiscountPercent,
      expectedDiscountPaise, status, reasons
    )
    VALUES (
      @tenantId, @branchId, @serviceCategory, @signalDate, @dayOfWeek, @hourSlot,
      @ourPricePaise, @baseDiscountPercent, @marketAvgPaise, @marketMinPaise,
      @marketMaxPaise, @competitorCount, @observationCount, @occupancyRate,
      @priceGapPercent, @marketPosition, @campaignAngle, @suggestedDiscountPercent,
      @expectedDiscountPaise, @status, @reasons
    )
  `).run(payload);
  return getSuggestion({ ...row, id: Number(result.lastInsertRowid) });
}

export function listSuggestions(scope = {}) {
  const current = normalizeScope(scope);
  const status = String(scope.status || "").trim();
  const limit = Math.min(100, Math.max(1, Number.parseInt(scope.limit, 10) || 25));
  return {
    rows: db.prepare(`
      SELECT *
      FROM happyHoursMarketAwareSuggestions
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND (@status = '' OR status = @status)
      ORDER BY createdAt DESC, id DESC
      LIMIT @limit
    `).all({ ...current, status, limit }).map(parseSuggestion)
  };
}

export function updateStatus(scope = {}) {
  const current = normalizeScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  const status = String(scope.status || "suggested").trim();
  db.prepare(`
    UPDATE happyHoursMarketAwareSuggestions
    SET status = @status
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).run({ ...current, id, status });
  return getSuggestion({ ...current, id });
}

function getSuggestion(scope = {}) {
  const current = normalizeScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  const row = db.prepare(`
    SELECT *
    FROM happyHoursMarketAwareSuggestions
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).get({ ...current, id });
  return parseSuggestion(row);
}

function parseSuggestion(row) {
  if (!row) return null;
  return {
    ...row,
    reasons: JSON.parse(row.reasons || "[]")
  };
}

export const happyHoursMarketAwareRepo = {
  evaluate,
  saveSuggestion,
  listSuggestions,
  updateStatus
};
