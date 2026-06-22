import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS discountBudgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    periodStart TEXT NOT NULL,
    periodEnd TEXT NOT NULL,
    budgetPaise INTEGER NOT NULL DEFAULT 0,
    spentPaise INTEGER NOT NULL DEFAULT 0,
    alertThresholdPercent INTEGER NOT NULL DEFAULT 80,
    status TEXT NOT NULL DEFAULT 'active',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, periodStart, periodEnd)
  );

  CREATE INDEX IF NOT EXISTS idx_discountBudgets_scope ON discountBudgets(tenantId, branchId, status);
  CREATE INDEX IF NOT EXISTS idx_discountBudgets_current ON discountBudgets(tenantId, branchId, periodStart, periodEnd);
`);

const statements = {
  upsert: db.prepare(`
    INSERT INTO discountBudgets (
      tenantId, branchId, periodStart, periodEnd, budgetPaise, spentPaise,
      alertThresholdPercent, status, createdBy
    )
    VALUES (
      @tenantId, @branchId, @periodStart, @periodEnd, @budgetPaise,
      COALESCE(@spentPaise, 0), @alertThresholdPercent, @status, @createdBy
    )
    ON CONFLICT(tenantId, branchId, periodStart, periodEnd)
    DO UPDATE SET
      budgetPaise = excluded.budgetPaise,
      alertThresholdPercent = excluded.alertThresholdPercent,
      status = excluded.status,
      updatedAt = strftime('%s','now')
  `),
  current: db.prepare(`
    SELECT * FROM discountBudgets
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
      AND periodStart <= @currentDate
      AND periodEnd >= @currentDate
    ORDER BY periodStart DESC, id DESC
    LIMIT 1
  `),
  recordSpend: db.prepare(`
    UPDATE discountBudgets
    SET spentPaise = spentPaise + @amountPaise,
        updatedAt = strftime('%s','now')
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
  `),
  alerts: db.prepare(`
    SELECT * FROM discountBudgets
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
      AND periodEnd >= @currentDate
      AND (
        budgetPaise <= 0
        OR spentPaise >= budgetPaise
        OR spentPaise >= CAST((budgetPaise * alertThresholdPercent) / 100 AS INTEGER)
      )
    ORDER BY periodStart ASC, id ASC
    LIMIT @limit
  `)
};

function istDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utcMs + 330 * 60000).toISOString().slice(0, 10);
}

function defaultPeriod(currentDate = istDate()) {
  const [year, month] = String(currentDate).slice(0, 10).split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    periodStart: `${year}-${String(month).padStart(2, "0")}-01`,
    periodEnd: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  };
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

function normalizeBudget(data = {}) {
  const currentDate = data.currentDate || istDate();
  const period = defaultPeriod(currentDate);
  return {
    ...requireScope(data),
    periodStart: String(data.periodStart || period.periodStart).slice(0, 10),
    periodEnd: String(data.periodEnd || period.periodEnd).slice(0, 10),
    budgetPaise: intPaise(data.budgetPaise),
    spentPaise: data.spentPaise === undefined ? null : intPaise(data.spentPaise),
    alertThresholdPercent: Math.min(100, Math.max(1, Number.parseInt(data.alertThresholdPercent, 10) || 80)),
    status: data.status === "paused" ? "paused" : "active",
    createdBy: data.createdBy || null
  };
}

function withComputed(row) {
  if (!row) return null;
  const budgetPaise = intPaise(row.budgetPaise);
  const spentPaise = intPaise(row.spentPaise);
  const remainingPaise = Math.max(0, budgetPaise - spentPaise);
  const usedPercent = budgetPaise > 0 ? Math.round((spentPaise * 10000) / budgetPaise) / 100 : 0;
  return {
    ...row,
    budgetPaise,
    spentPaise,
    remainingPaise,
    usedPercent,
    exceeded: budgetPaise > 0 && spentPaise >= budgetPaise
  };
}

export function setBudget(data = {}) {
  const payload = normalizeBudget(data);
  if (payload.periodEnd < payload.periodStart) throw new Error("periodEnd must be on or after periodStart");
  statements.upsert.run(payload);
  return getCurrentBudget({
    tenantId: payload.tenantId,
    branchId: payload.branchId,
    currentDate: payload.periodStart
  });
}

export function getCurrentBudget(scope = {}) {
  const current = {
    ...requireScope(scope),
    currentDate: String(scope.currentDate || istDate()).slice(0, 10)
  };
  return withComputed(statements.current.get(current));
}

export function recordSpend(data = {}) {
  const amountPaise = intPaise(data.amountPaise ?? data.discountPaise);
  if (amountPaise <= 0) return { changes: 0, budget: getCurrentBudget(data) };
  const budget = getCurrentBudget(data);
  if (!budget) return { changes: 0, budget: null };
  const changes = statements.recordSpend.run({
    id: budget.id,
    tenantId: budget.tenantId,
    branchId: budget.branchId,
    amountPaise
  }).changes;
  return { changes, budget: getCurrentBudget(data) };
}

export function checkRemaining(data = {}) {
  const requestedPaise = intPaise(data.requestedPaise ?? data.discountPaise ?? data.amountPaise);
  const budget = getCurrentBudget(data);
  if (!budget) {
    return {
      configured: false,
      allowed: true,
      requestedPaise,
      remainingPaise: null,
      budget: null,
      reason: "no_budget_configured"
    };
  }
  const allowed = requestedPaise <= budget.remainingPaise;
  return {
    configured: true,
    allowed,
    requestedPaise,
    remainingPaise: budget.remainingPaise,
    cappedDiscountPaise: Math.min(requestedPaise, budget.remainingPaise),
    budget,
    reason: allowed ? "budget_available" : "discount_budget_exceeded"
  };
}

export function alerts(scope = {}) {
  const current = {
    ...requireScope(scope),
    currentDate: String(scope.currentDate || istDate()).slice(0, 10),
    limit: Math.min(100, Math.max(1, Number.parseInt(scope.limit, 10) || 25))
  };
  return statements.alerts.all(current).map((row) => {
    const budget = withComputed(row);
    const reason = budget.budgetPaise <= 0
      ? "budget_not_set"
      : budget.exceeded
        ? "budget_exceeded"
        : "budget_threshold_reached";
    return { ...budget, reason };
  });
}

export const discountBudgetRepo = {
  setBudget,
  getCurrentBudget,
  recordSpend,
  checkRemaining,
  alerts
};
