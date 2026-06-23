import { db } from "../db.js";
import { clvRepo } from "./clv.repo.js";
import { clvPricer } from "../utils/clv-pricer.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS clientDiscountDecisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    clientId INTEGER NOT NULL,
    serviceCategory TEXT DEFAULT 'default',
    cartTotalPaise INTEGER NOT NULL DEFAULT 0,
    baseDiscountPercent INTEGER NOT NULL DEFAULT 0,
    recommendedDiscountPercent INTEGER NOT NULL DEFAULT 0,
    recommendedDiscountPaise INTEGER NOT NULL DEFAULT 0,
    strategy TEXT NOT NULL DEFAULT 'default',
    segment TEXT NOT NULL DEFAULT 'unknown',
    budgetCapApplied INTEGER NOT NULL DEFAULT 0,
    reasons TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_clientDiscountDecisions_scope
    ON clientDiscountDecisions(tenantId, branchId, clientId, createdAt);
`);

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function clampPercent(value, max = 40) {
  return Math.max(0, Math.min(max, Math.round(Number(value || 0))));
}

function segmentFrom(score) {
  if (!score) return "unknown";
  if (score.acquisitionStage === "at_risk" || Number(score.churnRisk || 0) >= 0.5) return "at_risk";
  if (score.acquisitionStage === "new") return "new";
  if (Number(score.predictedClvPaise || 0) >= 5000000) return "high_potential";
  if (Number(score.currentValuePaise || 0) >= 2000000) return "vip";
  if (score.acquisitionStage === "mature") return "loyal";
  return score.acquisitionStage || "growing";
}

function budgetCapPercent(score, cartTotalPaise) {
  const budget = Math.max(0, Math.round(Number(score?.recommendedDiscountBudgetPaise || 0)));
  if (!budget || !cartTotalPaise) return 40;
  return clampPercent((budget / cartTotalPaise) * 100, 40);
}

export function evaluateClientDiscount(input = {}) {
  const current = normalizeScope(input);
  const clientId = Number.parseInt(input.clientId, 10) || 0;
  if (!clientId) throw new Error("clientId is required");

  const cartTotalPaise = Math.max(0, Math.round(Number(input.cartTotalPaise || 0)));
  const baseDiscountPercent = clampPercent(input.baseDiscountPercent);
  const serviceCategory = String(input.serviceCategory || "default").trim() || "default";
  const score = clvRepo.getScore({ ...current, clientId });
  const clvDecision = clvPricer.getClvAdjustedDiscount({ ...current, clientId, baseDiscountPercent });
  const capPercent = budgetCapPercent(score, cartTotalPaise);
  const recommendedDiscountPercent = clampPercent(Math.min(clvDecision.discountPercent, capPercent));
  const budgetCapApplied = recommendedDiscountPercent < clvDecision.discountPercent;
  const recommendedDiscountPaise = Math.round(cartTotalPaise * (recommendedDiscountPercent / 100));
  const segment = segmentFrom(score);
  const reasons = [
    clvDecision.reason,
    score ? `Client segment: ${segment}.` : "No client score yet; default strategy used.",
    budgetCapApplied ? "Recommended discount budget cap applied." : "No budget cap needed."
  ];

  return {
    tenantId: current.tenantId,
    branchId: current.branchId,
    clientId,
    serviceCategory,
    cartTotalPaise,
    baseDiscountPercent,
    recommendedDiscountPercent,
    recommendedDiscountPaise,
    strategy: clvDecision.strategy,
    segment,
    budgetCapApplied,
    score,
    reasons,
    status: score ? "ready" : "collecting"
  };
}

export function recordDecision(input = {}) {
  const decision = evaluateClientDiscount(input);
  const payload = {
    ...decision,
    budgetCapApplied: decision.budgetCapApplied ? 1 : 0,
    reasons: JSON.stringify(decision.reasons || [])
  };
  const result = db.prepare(`
    INSERT INTO clientDiscountDecisions (
      tenantId, branchId, clientId, serviceCategory, cartTotalPaise,
      baseDiscountPercent, recommendedDiscountPercent, recommendedDiscountPaise,
      strategy, segment, budgetCapApplied, reasons
    )
    VALUES (
      @tenantId, @branchId, @clientId, @serviceCategory, @cartTotalPaise,
      @baseDiscountPercent, @recommendedDiscountPercent, @recommendedDiscountPaise,
      @strategy, @segment, @budgetCapApplied, @reasons
    )
  `).run(payload);
  return getDecision({ ...decision, id: Number(result.lastInsertRowid) });
}

export function getDecision(scope = {}) {
  const current = normalizeScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  if (!id) return null;
  const row = db.prepare(`
    SELECT *
    FROM clientDiscountDecisions
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).get({ ...current, id });
  return parseDecision(row);
}

export function recentDecisions(scope = {}) {
  const current = normalizeScope(scope);
  const limit = Math.min(100, Math.max(1, Number.parseInt(scope.limit, 10) || 25));
  return db.prepare(`
    SELECT *
    FROM clientDiscountDecisions
    WHERE tenantId = @tenantId AND branchId = @branchId
    ORDER BY createdAt DESC, id DESC
    LIMIT @limit
  `).all({ ...current, limit }).map(parseDecision);
}

function parseDecision(row) {
  if (!row) return null;
  return {
    ...row,
    budgetCapApplied: Boolean(row.budgetCapApplied),
    reasons: JSON.parse(row.reasons || "[]")
  };
}

export const clientDiscountBrainRepo = {
  evaluateClientDiscount,
  recordDecision,
  recentDecisions
};
