import { db } from "../db.js";

const STAGES = ["idea", "draft", "pending_approval", "approved", "live", "paused", "completed", "archived"];
const ACTIVE_STAGES = new Set(["idea", "draft", "pending_approval", "approved", "live", "paused"]);

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursOfferLifecycle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    ruleId INTEGER DEFAULT NULL,
    couponId INTEGER DEFAULT NULL,
    title TEXT NOT NULL,
    objective TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'idea',
    stageReason TEXT NOT NULL DEFAULT '',
    ownerUserId TEXT DEFAULT NULL,
    ownerRole TEXT DEFAULT NULL,
    budgetPaise INTEGER NOT NULL DEFAULT 0,
    targetRevenuePaise INTEGER NOT NULL DEFAULT 0,
    targetApplications INTEGER NOT NULL DEFAULT 0,
    validFrom TEXT DEFAULT NULL,
    validTo TEXT DEFAULT NULL,
    createdBy TEXT DEFAULT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hhOfferLifecycle_scope
    ON happyHoursOfferLifecycle(tenantId, branchId, stage, updatedAt);

  CREATE INDEX IF NOT EXISTS idx_hhOfferLifecycle_rule
    ON happyHoursOfferLifecycle(tenantId, branchId, ruleId, couponId);

  CREATE TABLE IF NOT EXISTS happyHoursOfferLifecycleEvents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    lifecycleId INTEGER NOT NULL,
    fromStage TEXT DEFAULT NULL,
    toStage TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    actorUserId TEXT DEFAULT NULL,
    actorRole TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hhOfferLifecycleEvents_scope
    ON happyHoursOfferLifecycleEvents(tenantId, branchId, lifecycleId, createdAt);
`);

const statements = {
  insert: db.prepare(`
    INSERT INTO happyHoursOfferLifecycle (
      tenantId, branchId, ruleId, couponId, title, objective, stage, stageReason,
      ownerUserId, ownerRole, budgetPaise, targetRevenuePaise, targetApplications,
      validFrom, validTo, createdBy, metadata
    )
    VALUES (
      @tenantId, @branchId, @ruleId, @couponId, @title, @objective, @stage, @stageReason,
      @ownerUserId, @ownerRole, @budgetPaise, @targetRevenuePaise, @targetApplications,
      @validFrom, @validTo, @createdBy, @metadata
    )
  `),
  update: db.prepare(`
    UPDATE happyHoursOfferLifecycle
    SET ruleId = @ruleId,
        couponId = @couponId,
        title = @title,
        objective = @objective,
        stage = @stage,
        stageReason = @stageReason,
        ownerUserId = @ownerUserId,
        ownerRole = @ownerRole,
        budgetPaise = @budgetPaise,
        targetRevenuePaise = @targetRevenuePaise,
        targetApplications = @targetApplications,
        validFrom = @validFrom,
        validTo = @validTo,
        metadata = @metadata,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  getById: db.prepare(`
    SELECT *
    FROM happyHoursOfferLifecycle
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
    LIMIT 1
  `),
  transition: db.prepare(`
    UPDATE happyHoursOfferLifecycle
    SET stage = @stage,
        stageReason = @stageReason,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  eventInsert: db.prepare(`
    INSERT INTO happyHoursOfferLifecycleEvents (
      tenantId, branchId, lifecycleId, fromStage, toStage, note, actorUserId, actorRole
    )
    VALUES (
      @tenantId, @branchId, @lifecycleId, @fromStage, @toStage, @note, @actorUserId, @actorRole
    )
  `),
  eventList: db.prepare(`
    SELECT *
    FROM happyHoursOfferLifecycleEvents
    WHERE tenantId = @tenantId AND branchId = @branchId AND lifecycleId = @lifecycleId
    ORDER BY createdAt DESC, id DESC
    LIMIT 100
  `)
};

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

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function jsonText(value, fallback = {}) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function dateOrNull(value) {
  const raw = String(value || "").trim();
  return raw ? raw.slice(0, 10) : null;
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

function cleanStage(value, fallback = "idea") {
  const stage = String(value || fallback).trim().toLowerCase();
  return STAGES.includes(stage) ? stage : fallback;
}

function normalize(data = {}) {
  const title = String(data.title || data.name || "").trim();
  if (!title) throw new Error("title is required");
  return {
    ...requireScope(data),
    id: idFrom(data.id),
    ruleId: idFrom(data.ruleId),
    couponId: idFrom(data.couponId),
    title,
    objective: String(data.objective || "").trim(),
    stage: cleanStage(data.stage),
    stageReason: String(data.stageReason || data.note || "").trim(),
    ownerUserId: data.ownerUserId || data.ownerId || null,
    ownerRole: data.ownerRole || data.role || null,
    budgetPaise: intPaise(data.budgetPaise),
    targetRevenuePaise: intPaise(data.targetRevenuePaise),
    targetApplications: Math.max(0, Number.parseInt(data.targetApplications, 10) || 0),
    validFrom: dateOrNull(data.validFrom),
    validTo: dateOrNull(data.validTo),
    createdBy: data.createdBy || null,
    metadata: jsonText(data.metadata, {})
  };
}

function parseLifecycle(row) {
  if (!row) return null;
  return {
    ...row,
    budgetPaise: intPaise(row.budgetPaise),
    targetRevenuePaise: intPaise(row.targetRevenuePaise),
    targetApplications: Number(row.targetApplications || 0),
    metadata: parseJson(row.metadata, {})
  };
}

function listSql({ stage }) {
  return `
    SELECT *
    FROM happyHoursOfferLifecycle
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      ${stage ? "AND stage = @stage" : ""}
    ORDER BY
      CASE stage
        WHEN 'live' THEN 1 WHEN 'approved' THEN 2 WHEN 'pending_approval' THEN 3
        WHEN 'draft' THEN 4 WHEN 'idea' THEN 5 WHEN 'paused' THEN 6
        WHEN 'completed' THEN 7 ELSE 8
      END,
      updatedAt DESC,
      id DESC
    LIMIT @limit OFFSET @offset
  `;
}

function rowsForRoi(scope = {}) {
  const current = requireScope(scope);
  const params = { ...current, fromTs: epochStart(scope.from), toTs: epochEnd(scope.to) };
  const rows = [];

  if (tableExists("offerRoiEvents")) {
    rows.push(...db.prepare(`
      SELECT ruleId, couponId, clientId, amountPaise, discountPaise, grossMarginPaise, repeatClient, metadata, createdAt
      FROM offerRoiEvents
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND createdAt >= @fromTs
        AND createdAt <= @toTs
    `).all(params).map((row) => ({ ...row, source: "manual_roi", metadata: parseJson(row.metadata, {}) })));
  }

  if (tableExists("discountAuditLog")) {
    rows.push(...db.prepare(`
      SELECT ruleId, NULL AS couponId, '' AS clientId, amountPaise, discountPaise, 0 AS grossMarginPaise, 0 AS repeatClient, metadata, createdAt
      FROM discountAuditLog
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND eventType = 'discount_applied'
        AND createdAt >= @fromTs
        AND createdAt <= @toTs
    `).all(params).map((row) => ({ ...row, source: "discount_audit", metadata: parseJson(row.metadata, {}) })));
  }

  return rows.map((row) => ({
    ...row,
    ruleId: idFrom(row.ruleId || row.metadata?.ruleId),
    couponId: idFrom(row.couponId || row.metadata?.couponId),
    clientId: String(row.clientId || row.metadata?.clientId || ""),
    amountPaise: intPaise(row.amountPaise),
    discountPaise: intPaise(row.discountPaise),
    grossMarginPaise: intPaise(row.grossMarginPaise || row.metadata?.grossMarginPaise),
    repeatClient: Boolean(row.repeatClient || row.metadata?.repeatClient)
  }));
}

function aggregateRows(lifecycle, rows) {
  const scopedRows = rows.filter((row) => {
    if (lifecycle.ruleId && row.ruleId === lifecycle.ruleId) return true;
    if (lifecycle.couponId && row.couponId === lifecycle.couponId) return true;
    return !lifecycle.ruleId && !lifecycle.couponId;
  });
  const clients = new Set();
  const summary = scopedRows.reduce((acc, row) => {
    acc.applications += 1;
    acc.grossRevenuePaise += row.amountPaise;
    acc.totalDiscountPaise += row.discountPaise;
    acc.netRevenuePaise += Math.max(0, row.amountPaise - row.discountPaise);
    acc.grossMarginPaise += row.grossMarginPaise;
    if (row.repeatClient) acc.repeatClients += 1;
    if (row.clientId) clients.add(row.clientId);
    return acc;
  }, {
    applications: 0,
    grossRevenuePaise: 0,
    netRevenuePaise: 0,
    totalDiscountPaise: 0,
    grossMarginPaise: 0,
    repeatClients: 0
  });
  return { ...summary, uniqueClients: clients.size };
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreFor(lifecycle, roi) {
  if (!roi.applications) {
    return {
      score: 0,
      grade: "no_data",
      recommendation: "Collect live outcomes before judging this offer.",
      components: {
        revenue: 0,
        returnOnDiscount: 0,
        margin: 0,
        repeat: 0,
        budget: 0
      }
    };
  }
  const revenueAchievement = lifecycle.targetRevenuePaise
    ? Math.min(25, (roi.netRevenuePaise / lifecycle.targetRevenuePaise) * 25)
    : Math.min(25, roi.netRevenuePaise > 0 ? 18 : 0);
  const returnOnDiscountPercent = roi.totalDiscountPaise ? (roi.netRevenuePaise / roi.totalDiscountPaise) * 100 : 0;
  const returnScore = Math.min(25, (returnOnDiscountPercent / 400) * 25);
  const marginPercent = roi.netRevenuePaise ? (roi.grossMarginPaise / roi.netRevenuePaise) * 100 : 0;
  const marginScore = roi.grossMarginPaise ? Math.min(20, (marginPercent / 35) * 20) : 10;
  const repeatRatePercent = roi.applications ? (roi.repeatClients / roi.applications) * 100 : 0;
  const repeatScore = Math.min(15, (repeatRatePercent / 25) * 15);
  const budgetScore = lifecycle.budgetPaise
    ? Math.max(0, Math.min(15, ((lifecycle.budgetPaise - roi.totalDiscountPaise) / lifecycle.budgetPaise) * 15 + 7))
    : 10;
  const score = clampScore(revenueAchievement + returnScore + marginScore + repeatScore + budgetScore);
  const grade = score >= 80 ? "excellent" : score >= 60 ? "good" : score >= 40 ? "watch" : "poor";
  const recommendation = grade === "excellent"
    ? "Scale this offer carefully; ROI and guardrails look strong."
    : grade === "good"
      ? "Keep live and monitor budget/margin weekly."
      : grade === "watch"
        ? "Review audience, cap, or timing before scaling."
        : "Pause or redesign unless this is a strategic acquisition offer.";
  return {
    score,
    grade,
    recommendation,
    components: {
      revenue: Math.round(revenueAchievement),
      returnOnDiscount: Math.round(returnScore),
      margin: Math.round(marginScore),
      repeat: Math.round(repeatScore),
      budget: Math.round(budgetScore)
    }
  };
}

function roiScore(lifecycle, scope = {}) {
  const from = scope.from || lifecycle.validFrom || null;
  const to = scope.to || lifecycle.validTo || null;
  const roi = aggregateRows(lifecycle, rowsForRoi({ ...lifecycle, from, to }));
  const discountRatePercent = roi.grossRevenuePaise ? Math.round((roi.totalDiscountPaise * 10000) / roi.grossRevenuePaise) / 100 : 0;
  const returnOnDiscountPercent = roi.totalDiscountPaise ? Math.round((roi.netRevenuePaise * 10000) / roi.totalDiscountPaise) / 100 : 0;
  const marginPercent = roi.netRevenuePaise && roi.grossMarginPaise ? Math.round((roi.grossMarginPaise * 10000) / roi.netRevenuePaise) / 100 : 0;
  const repeatRatePercent = roi.applications ? Math.round((roi.repeatClients * 10000) / roi.applications) / 100 : 0;
  const targetAchievementPercent = lifecycle.targetRevenuePaise ? Math.round((roi.netRevenuePaise * 10000) / lifecycle.targetRevenuePaise) / 100 : 0;
  return {
    from,
    to,
    ...roi,
    discountRatePercent,
    returnOnDiscountPercent,
    marginPercent,
    repeatRatePercent,
    targetAchievementPercent,
    ...scoreFor(lifecycle, roi),
    note: "ROI score uses discount_applied audit rows plus manual ROI outcomes; missing GST or margin values are not invented."
  };
}

export function createLifecycle(data = {}) {
  const payload = normalize(data);
  const result = statements.insert.run(payload);
  statements.eventInsert.run({
    ...payload,
    lifecycleId: Number(result.lastInsertRowid),
    fromStage: null,
    toStage: payload.stage,
    note: payload.stageReason || "Lifecycle created",
    actorUserId: payload.createdBy,
    actorRole: payload.ownerRole
  });
  return getLifecycle({ ...payload, id: Number(result.lastInsertRowid) });
}

export function updateLifecycle(data = {}) {
  const payload = normalize(data);
  if (!payload.id) throw new Error("valid lifecycle id is required");
  statements.update.run(payload);
  return getLifecycle(payload);
}

export function listLifecycles(scope = {}) {
  const current = requireScope(scope);
  const stage = STAGES.includes(String(scope.stage || "")) ? String(scope.stage) : "";
  const params = {
    ...current,
    stage,
    limit: Math.min(200, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
  const rows = db.prepare(listSql({ stage })).all(params).map(parseLifecycle);
  return {
    rows: rows.map((row) => ({ ...row, roiScore: roiScore(row, scope) })),
    limit: params.limit,
    offset: params.offset
  };
}

export function getLifecycle(scope = {}) {
  const current = requireScope(scope);
  const id = idFrom(scope.id);
  if (!id) throw new Error("valid lifecycle id is required");
  const row = parseLifecycle(statements.getById.get({ ...current, id }));
  if (!row) return null;
  return {
    ...row,
    roiScore: roiScore(row, scope),
    events: statements.eventList.all({ ...current, lifecycleId: id })
  };
}

export function transitionLifecycle(data = {}) {
  const current = requireScope(data);
  const id = idFrom(data.id);
  const stage = cleanStage(data.stage, "");
  if (!id || !stage) throw new Error("valid lifecycle id and stage are required");
  const existing = parseLifecycle(statements.getById.get({ ...current, id }));
  if (!existing) return null;
  const stageReason = String(data.stageReason || data.note || "").trim();
  statements.transition.run({ ...current, id, stage, stageReason });
  statements.eventInsert.run({
    ...current,
    lifecycleId: id,
    fromStage: existing.stage,
    toStage: stage,
    note: stageReason || `Moved from ${existing.stage} to ${stage}`,
    actorUserId: data.actorUserId || data.userId || null,
    actorRole: data.actorRole || data.role || null
  });
  return getLifecycle({ ...current, id });
}

export function getRoiScores(scope = {}) {
  const result = listLifecycles({ ...scope, limit: 200, offset: 0 });
  return {
    ...requireScope(scope),
    from: scope.from || null,
    to: scope.to || null,
    rows: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      stage: row.stage,
      ruleId: row.ruleId,
      couponId: row.couponId,
      budgetPaise: row.budgetPaise,
      targetRevenuePaise: row.targetRevenuePaise,
      roiScore: row.roiScore
    })).sort((left, right) => right.roiScore.score - left.roiScore.score)
  };
}

export function getSummary(scope = {}) {
  const rows = listLifecycles({ ...scope, limit: 200, offset: 0 }).rows;
  const totals = rows.reduce((acc, row) => {
    acc.total += 1;
    if (ACTIVE_STAGES.has(row.stage)) acc.active += 1;
    if (row.stage === "live") acc.live += 1;
    acc.netRevenuePaise += row.roiScore.netRevenuePaise;
    acc.totalDiscountPaise += row.roiScore.totalDiscountPaise;
    acc.applications += row.roiScore.applications;
    acc.scoreTotal += row.roiScore.score;
    return acc;
  }, { total: 0, active: 0, live: 0, netRevenuePaise: 0, totalDiscountPaise: 0, applications: 0, scoreTotal: 0 });
  return {
    ...requireScope(scope),
    ...totals,
    averageScore: totals.total ? Math.round(totals.scoreTotal / totals.total) : 0,
    byStage: STAGES.map((stage) => ({ stage, count: rows.filter((row) => row.stage === stage).length }))
  };
}

export const happyHoursLifecycleRepo = {
  createLifecycle,
  updateLifecycle,
  listLifecycles,
  getLifecycle,
  transitionLifecycle,
  getRoiScores,
  getSummary
};
