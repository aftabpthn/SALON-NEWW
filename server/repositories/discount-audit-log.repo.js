import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS discountAuditLog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    ruleId INTEGER DEFAULT NULL,
    eventType TEXT NOT NULL,
    actorUserId TEXT DEFAULT NULL,
    actorRole TEXT DEFAULT NULL,
    source TEXT DEFAULT 'discount-rules',
    amountPaise INTEGER NOT NULL DEFAULT 0,
    discountPaise INTEGER NOT NULL DEFAULT 0,
    gstImpactPaise INTEGER NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_discountAuditLog_scope ON discountAuditLog(tenantId, branchId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_discountAuditLog_rule ON discountAuditLog(tenantId, branchId, ruleId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_discountAuditLog_event ON discountAuditLog(tenantId, branchId, eventType, createdAt);
`);

const statements = {
  insert: db.prepare(`
    INSERT INTO discountAuditLog (
      tenantId, branchId, ruleId, eventType, actorUserId, actorRole, source,
      amountPaise, discountPaise, gstImpactPaise, note, metadata
    )
    VALUES (
      @tenantId, @branchId, @ruleId, @eventType, @actorUserId, @actorRole, @source,
      @amountPaise, @discountPaise, @gstImpactPaise, @note, @metadata
    )
  `),
  getById: db.prepare(`SELECT * FROM discountAuditLog WHERE id = @id`),
  ruleHistory: db.prepare(`
    SELECT * FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND ruleId = @ruleId
    ORDER BY createdAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `)
};

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function normalizeScope(scope = {}) {
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

function normalize(data = {}) {
  const metadata = {
    ...(data.metadata && typeof data.metadata === "object" ? data.metadata : {}),
    gstImpactNote: data.gstImpactNote || "GST delta unavailable; gstImpactPaise stored as 0."
  };
  return {
    ...normalizeScope(data),
    id: Number.parseInt(data.id, 10) || null,
    ruleId: Number.parseInt(data.ruleId, 10) || null,
    eventType: String(data.eventType || "").trim(),
    actorUserId: data.actorUserId || data.userId || null,
    actorRole: data.actorRole || data.role || null,
    source: data.source || "discount-rules",
    amountPaise: intPaise(data.amountPaise),
    discountPaise: intPaise(data.discountPaise),
    gstImpactPaise: intPaise(data.gstImpactPaise),
    note: String(data.note || ""),
    metadata: jsonText(metadata)
  };
}

function parseLog(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: parseJson(row.metadata, {})
  };
}

function querySql({ eventType }) {
  return `
    SELECT * FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
      ${eventType ? "AND eventType = @eventType" : ""}
    ORDER BY createdAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `;
}

export function log(data = {}) {
  const payload = normalize(data);
  if (!payload.eventType) throw new Error("eventType is required");
  const result = statements.insert.run(payload);
  return parseLog(statements.getById.get({ id: Number(result.lastInsertRowid) }));
}

export function query(scope = {}) {
  const eventType = String(scope.eventType || "").trim();
  const params = {
    ...normalizeScope(scope),
    eventType,
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to),
    limit: Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
  const rows = db.prepare(querySql({ eventType })).all(params).map(parseLog);
  return { rows, limit: params.limit, offset: params.offset };
}

export function getRuleHistory(scope = {}) {
  const params = {
    ...normalizeScope(scope),
    ruleId: Number.parseInt(scope.ruleId, 10) || 0,
    limit: Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
  return {
    rows: statements.ruleHistory.all(params).map(parseLog),
    limit: params.limit,
    offset: params.offset
  };
}

export function getComplianceReport(scope = {}) {
  const rows = query({ ...scope, limit: 500, offset: 0 }).rows;
  const byEventType = {};
  let totalDiscountPaise = 0;
  let totalGstImpactPaise = 0;
  for (const row of rows) {
    byEventType[row.eventType] = (byEventType[row.eventType] || 0) + 1;
    totalDiscountPaise += intPaise(row.discountPaise);
    totalGstImpactPaise += intPaise(row.gstImpactPaise);
  }
  return {
    from: scope.from || null,
    to: scope.to || null,
    totalEvents: rows.length,
    byEventType,
    totalDiscountPaise,
    totalGstImpactPaise,
    gstImpactNote: "Exact GST delta is not available in the discount engine; unknown values are stored as 0.",
    rows
  };
}

export const discountAuditLogRepo = {
  log,
  query,
  getRuleHistory,
  getComplianceReport
};
