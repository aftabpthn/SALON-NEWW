import { db } from "../db.js";
import { level6ReadinessRepo } from "../repositories/level6-readiness.repo.js";
import { checkBudgetGuard, checkMarginGuard } from "./discount-guardrails.js";

const CANDIDATE_DISCOUNTS = [0, 5, 10, 15, 20, 25, 30];
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function cleanScope(data = {}) {
  const tenantId = String(data.tenantId || "").trim();
  const branchId = String(data.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function qty(item = {}) {
  return Math.max(1, Number(item.qty ?? item.quantity ?? 1) || 1);
}

function cartItems(data = {}) {
  return (Array.isArray(data.cartItems) ? data.cartItems : []).map((item) => ({
    pricePaise: intPaise(item.pricePaise ?? item.unitPricePaise),
    costPaise: intPaise(item.costPaise ?? item.unitCostPaise ?? item.costPricePaise),
    qty: qty(item)
  }));
}

function cartTotalPaise(items = []) {
  return items.reduce((sum, item) => sum + item.pricePaise * item.qty, 0);
}

function cartCostPaise(items = []) {
  return items.reduce((sum, item) => sum + item.costPaise * item.qty, 0);
}

function dayKey(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (DAY_KEYS.includes(raw.slice(0, 3))) return raw.slice(0, 3);
  const numeric = Number.parseInt(raw, 10);
  if (numeric === 0) return "sun";
  if (numeric >= 1 && numeric <= 7) return DAY_KEYS[numeric % 7];
  return DAY_KEYS[new Date().getDay()];
}

function hourSlot(value) {
  return Math.max(0, Math.min(23, Number.parseInt(value, 10) || new Date().getHours()));
}

function exactRows(scope, dayOfWeek, slot) {
  try {
    return db.prepare(`
      SELECT
        activeDiscountPct,
        COUNT(*) AS sampleCount,
        ROUND(AVG(bookingsInSlot), 4) AS avgBookings,
        ROUND(AVG(slotsBooked), 4) AS avgSlotsBooked,
        ROUND(AVG(slotsAvailable), 4) AS avgSlotsAvailable,
        ROUND(AVG(occupancyRate), 4) AS avgOccupancy,
        ROUND(AVG(revenueInSlotPaise), 2) AS avgRevenuePaise,
        SUM(bookingsInSlot) AS totalBookings,
        SUM(revenueInSlotPaise) AS totalRevenuePaise
      FROM demandSignals
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND dayOfWeek = @dayOfWeek
        AND hourSlot = @hourSlot
      GROUP BY activeDiscountPct
      ORDER BY activeDiscountPct ASC
    `).all({ ...scope, dayOfWeek, hourSlot: slot });
  } catch {
    return [];
  }
}

function fallbackRows(scope, dayOfWeek) {
  try {
    return db.prepare(`
      SELECT
        activeDiscountPct,
        COUNT(*) AS sampleCount,
        ROUND(AVG(bookingsInSlot), 4) AS avgBookings,
        ROUND(AVG(slotsBooked), 4) AS avgSlotsBooked,
        ROUND(AVG(slotsAvailable), 4) AS avgSlotsAvailable,
        ROUND(AVG(occupancyRate), 4) AS avgOccupancy,
        ROUND(AVG(revenueInSlotPaise), 2) AS avgRevenuePaise,
        SUM(bookingsInSlot) AS totalBookings,
        SUM(revenueInSlotPaise) AS totalRevenuePaise
      FROM demandSignals
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND dayOfWeek = @dayOfWeek
      GROUP BY activeDiscountPct
      ORDER BY activeDiscountPct ASC
    `).all({ ...scope, dayOfWeek });
  } catch {
    return [];
  }
}

function allRows(scope) {
  try {
    return db.prepare(`
      SELECT
        activeDiscountPct,
        COUNT(*) AS sampleCount,
        ROUND(AVG(bookingsInSlot), 4) AS avgBookings,
        ROUND(AVG(slotsBooked), 4) AS avgSlotsBooked,
        ROUND(AVG(slotsAvailable), 4) AS avgSlotsAvailable,
        ROUND(AVG(occupancyRate), 4) AS avgOccupancy,
        ROUND(AVG(revenueInSlotPaise), 2) AS avgRevenuePaise,
        SUM(bookingsInSlot) AS totalBookings,
        SUM(revenueInSlotPaise) AS totalRevenuePaise
      FROM demandSignals
      WHERE tenantId = @tenantId
        AND branchId = @branchId
      GROUP BY activeDiscountPct
      ORDER BY activeDiscountPct ASC
    `).all(scope);
  } catch {
    return [];
  }
}

function normalizeRows(rows = []) {
  return rows.map((row) => ({
    discountPct: Math.max(0, Number(row.activeDiscountPct || 0)),
    sampleCount: Number(row.sampleCount || 0),
    avgBookings: Number(row.avgBookings || row.avgSlotsBooked || 0),
    avgSlotsAvailable: Number(row.avgSlotsAvailable || 0),
    avgOccupancy: Number(row.avgOccupancy || 0),
    avgRevenuePaise: intPaise(row.avgRevenuePaise),
    totalBookings: Number(row.totalBookings || 0),
    totalRevenuePaise: intPaise(row.totalRevenuePaise)
  })).filter((row) => row.sampleCount > 0);
}

function weightedAverage(rows = [], key) {
  const weight = rows.reduce((sum, row) => sum + row.sampleCount, 0);
  if (!weight) return 0;
  return rows.reduce((sum, row) => sum + Number(row[key] || 0) * row.sampleCount, 0) / weight;
}

function slopePerPercent(rows = []) {
  const ordered = rows.filter((row) => row.discountPct >= 0).sort((a, b) => a.discountPct - b.discountPct);
  if (ordered.length < 2) return 0;
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const gap = last.discountPct - first.discountPct;
  if (!gap) return 0;
  return (last.avgBookings - first.avgBookings) / gap;
}

function nearestRow(rows = [], discountPct) {
  return rows
    .map((row) => ({ row, distance: Math.abs(row.discountPct - discountPct) }))
    .sort((a, b) => a.distance - b.distance)[0] || null;
}

function readinessBlock(scope, readiness) {
  const f5 = readiness.modules.find((item) => item.code === "F5") || null;
  return {
    ...scope,
    simulationType: "digital_twin",
    blocked: true,
    blockReason: "f5_data_gate_not_ready",
    readiness: f5,
    summary: {
      status: f5?.status || "blocked",
      evidence: f5?.evidence || "F5 readiness unavailable",
      nextAction: f5?.nextAction || "Collect 90 days invoices, demand signals, and elasticity data."
    },
    candidates: [],
    recommendation: null,
    notes: [
      "Digital twin simulation needs real historical signals; no fake projection was generated.",
      "Keep E6 demand snapshots running and save real simulations until F5 readiness becomes ready."
    ]
  };
}

export function simulateDigitalTwin(data = {}) {
  const scope = cleanScope(data);
  const readiness = level6ReadinessRepo.getLevel6Readiness(scope);
  const f5 = readiness.modules.find((item) => item.code === "F5");
  if (!f5 || f5.status !== "ready") return readinessBlock(scope, readiness);

  const items = cartItems(data);
  const grossPaise = intPaise(data.cartTotalPaise || cartTotalPaise(items) || data.servicePricePaise);
  const costPaise = intPaise(data.cartCostPaise || cartCostPaise(items));
  const servicePricePaise = grossPaise || intPaise(data.servicePricePaise);
  const dayOfWeek = dayKey(data.dayOfWeek ?? data.context?.dayOfWeek);
  const slot = hourSlot(data.hourSlot ?? data.context?.hourSlot);
  const minMarginPercent = Number(data.minMarginPercent ?? data.context?.minMarginPercent ?? 30) || 30;

  const exact = normalizeRows(exactRows(scope, dayOfWeek, slot));
  const fallback = exact.length ? exact : normalizeRows(fallbackRows(scope, dayOfWeek));
  const history = fallback.length ? fallback : normalizeRows(allRows(scope));
  if (!history.length || !servicePricePaise) {
    return {
      ...readinessBlock(scope, readiness),
      blockReason: "f5_source_data_missing",
      summary: {
        status: "blocked",
        evidence: "No usable demandSignals rows or service price for this scenario.",
        nextAction: "Record demand signals and provide a service/cart price."
      }
    };
  }

  const baseBookings = Math.max(0, weightedAverage(history, "avgBookings"));
  const baseDiscount = Math.round(weightedAverage(history, "discountPct"));
  const slope = slopePerPercent(history);
  const unitCostPaise = costPaise > 0 && servicePricePaise > 0 ? costPaise / servicePricePaise : 0;
  const candidates = CANDIDATE_DISCOUNTS.map((discountPct) => {
    const exactMatch = history.find((row) => row.discountPct === discountPct);
    const nearest = nearestRow(history, discountPct);
    const projectedBookings = exactMatch
      ? exactMatch.avgBookings
      : Math.max(0, baseBookings + slope * (discountPct - baseDiscount));
    const projectedGrossRevenuePaise = intPaise(projectedBookings * servicePricePaise);
    const projectedDiscountPaise = intPaise(projectedGrossRevenuePaise * discountPct / 100);
    const projectedCostPaise = intPaise(projectedGrossRevenuePaise * unitCostPaise);
    const margin = checkMarginGuard({
      discountPaise: projectedDiscountPaise,
      sellPricePaise: projectedGrossRevenuePaise,
      costPaise: projectedCostPaise || null,
      minMarginPercent
    });
    const budget = checkBudgetGuard({
      ...scope,
      requestedPaise: margin.cappedDiscountPaise
    });
    const expectedRevenuePaise = Math.max(0, projectedGrossRevenuePaise - margin.cappedDiscountPaise);
    const expectedGrossProfitPaise = Math.max(0, expectedRevenuePaise - projectedCostPaise);
    const directSampleCount = exactMatch?.sampleCount || 0;
    const confidence = Math.min(0.95, Math.max(0.35, (directSampleCount ? 0.55 : 0.4) + Math.min(0.35, (nearest?.row.sampleCount || 0) / 200)));
    return {
      discountPct,
      projectedBookings: Math.round(projectedBookings * 100) / 100,
      projectedGrossRevenuePaise,
      projectedDiscountPaise: margin.cappedDiscountPaise,
      attemptedDiscountPaise: projectedDiscountPaise,
      expectedRevenuePaise,
      expectedGrossProfitPaise,
      projectedCostPaise,
      sampleCount: directSampleCount,
      nearestHistoricalDiscountPct: nearest?.row.discountPct ?? null,
      confidence: Math.round(confidence * 100) / 100,
      margin,
      budget,
      blocked: margin.denied || !budget.allowed,
      risk: margin.denied ? "margin_blocked" : (!budget.allowed ? "budget_blocked" : "ok")
    };
  });

  const recommendation = candidates
    .filter((item) => !item.blocked)
    .sort((a, b) => b.expectedGrossProfitPaise - a.expectedGrossProfitPaise || b.expectedRevenuePaise - a.expectedRevenuePaise)[0] || null;

  return {
    ...scope,
    simulationType: "digital_twin",
    blocked: false,
    dayOfWeek,
    hourSlot: slot,
    grossPaise: servicePricePaise,
    costPaise,
    readiness: f5,
    dataSource: {
      scope: exact.length ? "day_hour" : (fallback.length ? "day" : "branch"),
      rows: history,
      sampleCount: history.reduce((sum, row) => sum + row.sampleCount, 0),
      slopeBookingsPerDiscountPoint: Math.round(slope * 10000) / 10000
    },
    candidates,
    recommendation,
    notes: [
      "Digital twin is advisory; it does not create or activate a discount rule.",
      "Ranking uses expected gross profit first, then expected revenue, with budget and margin guardrails."
    ]
  };
}

export const digitalTwinSimulator = { simulateDigitalTwin };
