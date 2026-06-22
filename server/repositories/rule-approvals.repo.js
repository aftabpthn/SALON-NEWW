import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS ruleApprovals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    ruleId INTEGER NOT NULL,
    requestedBy TEXT DEFAULT NULL,
    requestedRole TEXT NOT NULL DEFAULT '',
    requestedPercent REAL NOT NULL DEFAULT 0,
    roleLimitPercent REAL NOT NULL DEFAULT 0,
    requestedStatus TEXT NOT NULL DEFAULT 'active',
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT DEFAULT '',
    decisionNote TEXT DEFAULT '',
    decidedBy TEXT DEFAULT NULL,
    decidedAt INTEGER DEFAULT NULL,
    ruleSnapshot TEXT NOT NULL DEFAULT '{}',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ruleApprovals_pending ON ruleApprovals(tenantId, branchId, status, createdAt);
  CREATE INDEX IF NOT EXISTS idx_ruleApprovals_rule ON ruleApprovals(tenantId, branchId, ruleId, status);
`);

const statements = {
  supersedePending: db.prepare(`
    UPDATE ruleApprovals
    SET status = 'superseded',
        decisionNote = 'Superseded by a newer approval request',
        decidedAt = strftime('%s','now'),
        updatedAt = strftime('%s','now')
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND ruleId = @ruleId
      AND status = 'pending'
  `),
  create: db.prepare(`
    INSERT INTO ruleApprovals (
      tenantId, branchId, ruleId, requestedBy, requestedRole, requestedPercent,
      roleLimitPercent, requestedStatus, status, note, ruleSnapshot
    )
    VALUES (
      @tenantId, @branchId, @ruleId, @requestedBy, @requestedRole, @requestedPercent,
      @roleLimitPercent, @requestedStatus, 'pending', @note, @ruleSnapshot
    )
  `),
  getById: db.prepare(`
    SELECT * FROM ruleApprovals
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  listPending: db.prepare(`
    SELECT * FROM ruleApprovals
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'pending'
    ORDER BY createdAt ASC, id ASC
    LIMIT @limit OFFSET @offset
  `),
  approve: db.prepare(`
    UPDATE ruleApprovals
    SET status = 'approved',
        decisionNote = @decisionNote,
        decidedBy = @decidedBy,
        decidedAt = strftime('%s','now'),
        updatedAt = strftime('%s','now')
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'pending'
  `),
  reject: db.prepare(`
    UPDATE ruleApprovals
    SET status = 'rejected',
        decisionNote = @decisionNote,
        decidedBy = @decidedBy,
        decidedAt = strftime('%s','now'),
        updatedAt = strftime('%s','now')
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'pending'
  `)
};

function jsonText(value, fallback = "{}") {
  if (value === undefined || value === null || value === "") return fallback;
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

function normalizeScope(scope = {}) {
  return {
    tenantId: String(scope.tenantId || "").trim(),
    branchId: String(scope.branchId || "").trim()
  };
}

function normalize(data = {}) {
  const scope = normalizeScope(data);
  return {
    ...scope,
    id: Number.parseInt(data.id, 10) || null,
    ruleId: Number.parseInt(data.ruleId, 10) || null,
    requestedBy: data.requestedBy || null,
    requestedRole: String(data.requestedRole || ""),
    requestedPercent: Number(data.requestedPercent || 0) || 0,
    roleLimitPercent: Number(data.roleLimitPercent || 0) || 0,
    requestedStatus: data.requestedStatus || "active",
    note: String(data.note || ""),
    decisionNote: String(data.decisionNote || data.note || ""),
    decidedBy: data.decidedBy || null,
    ruleSnapshot: jsonText(data.ruleSnapshot, "{}")
  };
}

function parseApproval(row) {
  if (!row) return null;
  return {
    ...row,
    ruleSnapshot: parseJson(row.ruleSnapshot, {})
  };
}

export function create(data = {}) {
  const payload = normalize(data);
  statements.supersedePending.run(payload);
  const result = statements.create.run(payload);
  return getById({ ...payload, id: Number(result.lastInsertRowid) });
}

export function listPending(scope = {}) {
  const current = {
    ...normalizeScope(scope),
    limit: Math.min(200, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
  return {
    rows: statements.listPending.all(current).map(parseApproval),
    limit: current.limit,
    offset: current.offset
  };
}

export function approve(data = {}) {
  const payload = normalize(data);
  statements.approve.run(payload);
  return getById(payload);
}

export function reject(data = {}) {
  const payload = normalize(data);
  statements.reject.run(payload);
  return getById(payload);
}

export function getById(scope = {}) {
  const current = normalize(scope);
  return parseApproval(statements.getById.get(current));
}

export const ruleApprovalsRepo = {
  create,
  listPending,
  approve,
  reject,
  getById
};
