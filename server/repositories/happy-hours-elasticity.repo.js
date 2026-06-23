import { db } from "../db.js";
import { marginConfig } from "../config/margin-config.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursProfitAssumptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    serviceCategory TEXT NOT NULL DEFAULT 'default',
    baseCostPaise INTEGER NOT NULL DEFAULT 0,
    variableCostPercent REAL NOT NULL DEFAULT 0,
    staffCommissionPercent REAL NOT NULL DEFAULT 0,
    paymentFeePercent REAL NOT NULL DEFAULT 0,
    gstPercent REAL NOT NULL DEFAULT 18,
    minMarginPercent REAL NOT NULL DEFAULT 30,
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, serviceCategory)
  );
`);

const DEFAULT_ASSUMPTION = {
  serviceCategory: "default",
  baseCostPaise: 0,
  variableCostPercent: 0,
  staffCommissionPercent: 0,
  paymentFeePercent: 0,
  gstPercent: 18,
  minMarginPercent: marginConfig.minMarginPercent
};

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function cleanCategory(value) {
  return String(value || "default").trim() || "default";
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function pct(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function filters(scope = {}) {
  const current = normalizeScope(scope);
  return {
    ...current,
    dayOfWeek: String(scope.dayOfWeek || "").slice(0, 3).toLowerCase(),
    hourSlot: scope.hourSlot === undefined || scope.hourSlot === "" ? -1 : Math.max(0, Math.min(23, Number.parseInt(scope.hourSlot, 10) || 0)),
    from: scope.from || null,
    to: scope.to || null
  };
}

function tableExists(tableName) {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = @tableName
  `).get({ tableName });
  return Boolean(row);
}

function readBands(scope = {}) {
  if (!tableExists("demandSignals")) return [];
  return db.prepare(`
    SELECT
      activeDiscountPct AS discountPct,
      COUNT(*) AS sampleCount,
      SUM(bookingsInSlot) AS bookings,
      SUM(revenueInSlotPaise) AS revenuePaise,
      ROUND(AVG(bookingsInSlot), 4) AS avgBookingsPerSlot,
      ROUND(AVG(revenueInSlotPaise), 0) AS avgRevenuePerSlot,
      ROUND(AVG(occupancyRate), 4) AS occupancyRate
    FROM demandSignals
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND (@dayOfWeek = '' OR dayOfWeek = @dayOfWeek)
      AND (@hourSlot = -1 OR hourSlot = @hourSlot)
      AND (@from IS NULL OR signalDate >= @from)
      AND (@to IS NULL OR signalDate <= @to)
    GROUP BY activeDiscountPct
    ORDER BY activeDiscountPct ASC
  `).all(filters(scope)).map((row) => ({
    discountPct: Math.max(0, Number(row.discountPct || 0)),
    sampleCount: Number(row.sampleCount || 0),
    bookings: Number(row.bookings || 0),
    revenuePaise: intPaise(row.revenuePaise),
    avgBookingsPerSlot: Number(row.avgBookingsPerSlot || 0),
    avgRevenuePerSlot: intPaise(row.avgRevenuePerSlot),
    occupancyRate: Number(row.occupancyRate || 0)
  }));
}

function enrichElasticity(bands = []) {
  if (!bands.length) return { baseline: null, bands: [] };
  const baseline = bands.find((band) => band.discountPct === 0) || bands[0];
  const baselineBookings = Math.max(0.0001, baseline.avgBookingsPerSlot || 0.0001);
  const baselineRevenue = Math.max(1, baseline.avgRevenuePerSlot || 1);
  const baselineDiscount = baseline.discountPct;
  return {
    baseline,
    bands: bands.map((band) => {
      const discountDelta = Math.max(1, Math.abs(band.discountPct - baselineDiscount));
      const demandLiftPercent = ((band.avgBookingsPerSlot - baselineBookings) / baselineBookings) * 100;
      const revenueLiftPercent = ((band.avgRevenuePerSlot - baselineRevenue) / baselineRevenue) * 100;
      const elasticity = band.discountPct === baselineDiscount ? 0 : demandLiftPercent / discountDelta;
      const revenuePerBookingPaise = band.bookings > 0 ? Math.round(band.revenuePaise / band.bookings) : 0;
      return {
        ...band,
        demandLiftPercent: Math.round(demandLiftPercent * 10) / 10,
        revenueLiftPercent: Math.round(revenueLiftPercent * 10) / 10,
        elasticity: Math.round(elasticity * 100) / 100,
        revenuePerBookingPaise
      };
    })
  };
}

export function listAssumptions(scope = {}) {
  const current = normalizeScope(scope);
  return db.prepare(`
    SELECT *
    FROM happyHoursProfitAssumptions
    WHERE tenantId = @tenantId AND branchId = @branchId
    ORDER BY serviceCategory ASC
  `).all(current);
}

export function getAssumption(scope = {}) {
  const current = normalizeScope(scope);
  const serviceCategory = cleanCategory(scope.serviceCategory);
  const row = db.prepare(`
    SELECT *
    FROM happyHoursProfitAssumptions
    WHERE tenantId = @tenantId AND branchId = @branchId AND serviceCategory = @serviceCategory
  `).get({ ...current, serviceCategory });
  return row || { ...current, ...DEFAULT_ASSUMPTION, serviceCategory };
}

export function setAssumption(data = {}) {
  const current = normalizeScope(data);
  const payload = {
    ...current,
    serviceCategory: cleanCategory(data.serviceCategory),
    baseCostPaise: intPaise(data.baseCostPaise),
    variableCostPercent: pct(data.variableCostPercent),
    staffCommissionPercent: pct(data.staffCommissionPercent),
    paymentFeePercent: pct(data.paymentFeePercent),
    gstPercent: pct(data.gstPercent, 18),
    minMarginPercent: pct(data.minMarginPercent, marginConfig.minMarginPercent)
  };
  db.prepare(`
    INSERT INTO happyHoursProfitAssumptions (
      tenantId, branchId, serviceCategory, baseCostPaise, variableCostPercent,
      staffCommissionPercent, paymentFeePercent, gstPercent, minMarginPercent
    )
    VALUES (
      @tenantId, @branchId, @serviceCategory, @baseCostPaise, @variableCostPercent,
      @staffCommissionPercent, @paymentFeePercent, @gstPercent, @minMarginPercent
    )
    ON CONFLICT(tenantId, branchId, serviceCategory) DO UPDATE SET
      baseCostPaise = excluded.baseCostPaise,
      variableCostPercent = excluded.variableCostPercent,
      staffCommissionPercent = excluded.staffCommissionPercent,
      paymentFeePercent = excluded.paymentFeePercent,
      gstPercent = excluded.gstPercent,
      minMarginPercent = excluded.minMarginPercent,
      updatedAt = strftime('%s','now')
  `).run(payload);
  return getAssumption(payload);
}

export function profitPreview(scope = {}) {
  const servicePricePaise = intPaise(scope.servicePricePaise);
  const discountPct = pct(scope.discountPct);
  const quantity = Math.max(1, Number.parseInt(scope.quantity, 10) || 1);
  const assumption = getAssumption(scope);
  const discountPaise = Math.round(servicePricePaise * (discountPct / 100));
  const netRevenuePaise = Math.max(0, servicePricePaise - discountPaise);
  const variableCostPaise = Math.round(servicePricePaise * (Number(assumption.variableCostPercent || 0) / 100));
  const staffCommissionPaise = Math.round(netRevenuePaise * (Number(assumption.staffCommissionPercent || 0) / 100));
  const paymentFeePaise = Math.round(netRevenuePaise * (Number(assumption.paymentFeePercent || 0) / 100));
  const unitCostPaise = intPaise(assumption.baseCostPaise) + variableCostPaise + staffCommissionPaise + paymentFeePaise;
  const unitProfitPaise = netRevenuePaise - unitCostPaise;
  const marginPercent = netRevenuePaise > 0 ? Math.round((unitProfitPaise / netRevenuePaise) * 1000) / 10 : 0;
  const minMarginPercent = Number(assumption.minMarginPercent || marginConfig.minMarginPercent);
  return {
    servicePricePaise,
    discountPct,
    quantity,
    serviceCategory: assumption.serviceCategory,
    discountPaise: discountPaise * quantity,
    netRevenuePaise: netRevenuePaise * quantity,
    estimatedCostPaise: unitCostPaise * quantity,
    estimatedProfitPaise: unitProfitPaise * quantity,
    marginPercent,
    minMarginPercent,
    marginSafe: marginPercent >= minMarginPercent,
    costBreakdown: {
      baseCostPaise: intPaise(assumption.baseCostPaise) * quantity,
      variableCostPaise: variableCostPaise * quantity,
      staffCommissionPaise: staffCommissionPaise * quantity,
      paymentFeePaise: paymentFeePaise * quantity
    },
    assumption
  };
}

export function elasticitySummary(scope = {}) {
  const { baseline, bands } = enrichElasticity(readBands(scope));
  return {
    filters: filters(scope),
    status: bands.length ? "ready" : "collecting",
    baseline,
    bands,
    note: bands.length
      ? "Elasticity is based on observed demandSignals by discount level."
      : "No demandSignals found for this filter yet."
  };
}

export function profitAwareRecommendation(scope = {}) {
  const summary = elasticitySummary(scope);
  const candidates = summary.bands.map((band) => {
    const preview = profitPreview({ ...scope, discountPct: band.discountPct, quantity: 1 });
    const expectedBookings = Math.max(0, band.avgBookingsPerSlot);
    return {
      discountPct: band.discountPct,
      sampleCount: band.sampleCount,
      elasticity: band.elasticity,
      expectedBookings,
      expectedRevenuePaise: Math.round(preview.netRevenuePaise * expectedBookings),
      expectedProfitPaise: Math.round(preview.estimatedProfitPaise * expectedBookings),
      marginPercent: preview.marginPercent,
      marginSafe: preview.marginSafe,
      demandLiftPercent: band.demandLiftPercent
    };
  });
  const safeCandidates = candidates.filter((candidate) => candidate.marginSafe);
  const pool = safeCandidates.length ? safeCandidates : candidates;
  const winner = [...pool].sort((a, b) => b.expectedProfitPaise - a.expectedProfitPaise || a.discountPct - b.discountPct)[0] || null;
  return {
    status: winner ? "ready" : "collecting",
    recommendedDiscountPct: winner?.discountPct ?? null,
    expectedProfitPaise: winner?.expectedProfitPaise || 0,
    expectedRevenuePaise: winner?.expectedRevenuePaise || 0,
    marginPercent: winner?.marginPercent || 0,
    candidates,
    reasoning: winner
      ? [
          `${winner.discountPct}% has the best observed expected profit for the selected filter.`,
          winner.marginSafe ? "Margin guard is safe for this candidate." : "No candidate met margin guard; showing best available candidate for review only."
        ]
      : ["Collect more demandSignals before profit-aware recommendation."],
    source: {
      elasticity: "demandSignals grouped by activeDiscountPct",
      profit: "happyHoursProfitAssumptions plus servicePricePaise"
    }
  };
}

export const happyHoursElasticityRepo = {
  listAssumptions,
  getAssumption,
  setAssumption,
  profitPreview,
  elasticitySummary,
  profitAwareRecommendation
};
