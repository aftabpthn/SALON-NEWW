import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS discountAnomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    signature TEXT NOT NULL,
    anomalyType TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'open',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    evidenceJson TEXT NOT NULL DEFAULT '{}',
    detectedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    reviewedBy TEXT DEFAULT NULL,
    reviewedAt INTEGER DEFAULT NULL,
    reviewNote TEXT NOT NULL DEFAULT '',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, signature)
  );

  CREATE INDEX IF NOT EXISTS idx_discountAnomalies_scope ON discountAnomalies(tenantId, branchId, status, detectedAt);
  CREATE INDEX IF NOT EXISTS idx_discountAnomalies_type ON discountAnomalies(tenantId, branchId, anomalyType, severity);
`);

const severities = new Set(["low", "medium", "high", "critical"]);
const statuses = new Set(["open", "reviewed", "dismissed"]);

const statements = {
  upsert: db.prepare(`
    INSERT INTO discountAnomalies (
      tenantId, branchId, signature, anomalyType, severity, status, title,
      description, evidenceJson, detectedAt
    )
    VALUES (
      @tenantId, @branchId, @signature, @anomalyType, @severity, @status, @title,
      @description, @evidenceJson, @detectedAt
    )
    ON CONFLICT(tenantId, branchId, signature)
    DO UPDATE SET
      anomalyType = excluded.anomalyType,
      severity = excluded.severity,
      title = excluded.title,
      description = excluded.description,
      evidenceJson = excluded.evidenceJson,
      detectedAt = excluded.detectedAt,
      status = CASE
        WHEN discountAnomalies.status = 'reviewed' THEN discountAnomalies.status
        ELSE excluded.status
      END,
      updatedAt = strftime('%s','now')
  `),
  getBySignature: db.prepare(`
    SELECT * FROM discountAnomalies
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND signature = @signature
    LIMIT 1
  `),
  list: db.prepare(`
    SELECT * FROM discountAnomalies
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND (@status IS NULL OR status = @status)
      AND (@severity IS NULL OR severity = @severity)
      AND (@anomalyType IS NULL OR anomalyType = @anomalyType)
    ORDER BY detectedAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `),
  review: db.prepare(`
    UPDATE discountAnomalies
    SET status = @status,
        reviewedBy = @reviewedBy,
        reviewedAt = strftime('%s','now'),
        reviewNote = @reviewNote,
        updatedAt = strftime('%s','now')
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
  `),
  getById: db.prepare(`
    SELECT * FROM discountAnomalies
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
    LIMIT 1
  `)
};

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonText(value, fallback = {}) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value);
}

function normalizeSeverity(value) {
  const severity = String(value || "medium").trim();
  return severities.has(severity) ? severity : "medium";
}

function normalizeStatus(value, fallback = "open") {
  const status = String(value || fallback).trim();
  return statuses.has(status) ? status : fallback;
}

function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: parseJson(row.evidenceJson, {})
  };
}

function normalizeAnomaly(data = {}) {
  const anomalyType = String(data.anomalyType || "").trim();
  const title = String(data.title || "").trim();
  if (!anomalyType) throw new Error("anomalyType is required");
  if (!title) throw new Error("title is required");
  const signature = String(data.signature || `${anomalyType}:${title}`).trim();
  return {
    ...requireScope(data),
    signature,
    anomalyType,
    severity: normalizeSeverity(data.severity),
    status: normalizeStatus(data.status, "open"),
    title,
    description: String(data.description || ""),
    evidenceJson: jsonText(data.evidence ?? data.evidenceJson, {}),
    detectedAt: Number.parseInt(data.detectedAt, 10) || Math.floor(Date.now() / 1000)
  };
}

export function recordAnomaly(data = {}) {
  const payload = normalizeAnomaly(data);
  statements.upsert.run(payload);
  return parseRow(statements.getBySignature.get(payload));
}

export function listAnomalies(scope = {}) {
  const current = requireScope(scope);
  const status = scope.status ? normalizeStatus(scope.status) : null;
  const severity = scope.severity ? normalizeSeverity(scope.severity) : null;
  const anomalyType = scope.anomalyType ? String(scope.anomalyType).trim() : null;
  const limit = Math.min(200, Math.max(1, Number.parseInt(scope.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(scope.offset, 10) || 0);
  return {
    rows: statements.list.all({ ...current, status, severity, anomalyType, limit, offset }).map(parseRow),
    limit,
    offset
  };
}

export function markReviewed(data = {}) {
  const current = requireScope(data);
  const id = Number.parseInt(data.id, 10) || 0;
  if (!id) throw new Error("valid anomaly id is required");
  const status = normalizeStatus(data.status, "reviewed");
  const changes = statements.review.run({
    ...current,
    id,
    status,
    reviewedBy: data.reviewedBy || null,
    reviewNote: String(data.reviewNote || data.note || "")
  }).changes;
  return { changes, anomaly: parseRow(statements.getById.get({ ...current, id })) };
}

export const discountAnomaliesRepo = {
  recordAnomaly,
  listAnomalies,
  markReviewed
};
