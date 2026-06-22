import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS discountRules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    conditions TEXT NOT NULL DEFAULT '[]',
    conditionLogic TEXT NOT NULL DEFAULT 'AND',
    action TEXT NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 100,
    stackable INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    validFrom TEXT DEFAULT NULL,
    validTo TEXT DEFAULT NULL,
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_discRules_scope ON discountRules(tenantId, branchId, status);
  CREATE INDEX IF NOT EXISTS idx_discRules_active ON discountRules(tenantId, branchId, status, priority);
`);

const VALID_STATUSES = new Set(["draft", "pending_approval", "active", "paused", "expired"]);
const VALID_LOGIC = new Set(["AND", "OR"]);

const statements = {
  create: db.prepare(`
    INSERT INTO discountRules (
      tenantId, branchId, name, description, conditions, conditionLogic, action,
      priority, stackable, status, validFrom, validTo, createdBy
    )
    VALUES (
      @tenantId, @branchId, @name, @description, @conditions, @conditionLogic, @action,
      @priority, @stackable, @status, @validFrom, @validTo, @createdBy
    )
  `),
  getById: db.prepare(`
    SELECT * FROM discountRules
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  update: db.prepare(`
    UPDATE discountRules
    SET name = @name,
        description = @description,
        conditions = @conditions,
        conditionLogic = @conditionLogic,
        action = @action,
        priority = @priority,
        stackable = @stackable,
        status = @status,
        validFrom = @validFrom,
        validTo = @validTo,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  updateStatus: db.prepare(`
    UPDATE discountRules
    SET status = @status,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  remove: db.prepare(`
    DELETE FROM discountRules
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  activeRules: db.prepare(`
    SELECT * FROM discountRules
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
      AND (validFrom IS NULL OR validFrom <= @today)
      AND (validTo IS NULL OR validTo >= @today)
    ORDER BY priority DESC, id ASC
  `)
};

function jsonText(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value);
}

function normalize(data = {}) {
  const conditionLogic = String(data.conditionLogic || "AND").toUpperCase();
  return {
    tenantId: data.tenantId,
    branchId: data.branchId,
    id: Number.parseInt(data.id, 10) || null,
    name: String(data.name || "").trim(),
    description: String(data.description || ""),
    conditions: jsonText(data.conditions, "[]"),
    conditionLogic: VALID_LOGIC.has(conditionLogic) ? conditionLogic : "AND",
    action: jsonText(data.action, "{}"),
    priority: Number.parseInt(data.priority, 10) || 100,
    stackable: data.stackable ? 1 : 0,
    status: VALID_STATUSES.has(data.status) ? data.status : "draft",
    validFrom: data.validFrom || null,
    validTo: data.validTo || null,
    createdBy: data.createdBy || null
  };
}

function parseRule(row) {
  if (!row) return null;
  return {
    ...row,
    stackable: Boolean(row.stackable),
    conditionsJson: JSON.parse(row.conditions || "[]"),
    actionJson: JSON.parse(row.action || "{}")
  };
}

function listSql({ status }) {
  return `
    SELECT * FROM discountRules
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      ${status ? "AND status = @status" : ""}
    ORDER BY priority DESC, updatedAt DESC
    LIMIT @limit OFFSET @offset
  `;
}

export function create(data = {}) {
  const payload = normalize(data);
  const result = statements.create.run(payload);
  return getById({ tenantId: payload.tenantId, branchId: payload.branchId, id: Number(result.lastInsertRowid) });
}

export function getById(scope = {}) {
  return parseRule(statements.getById.get(scope));
}

export function list(scope = {}) {
  const status = VALID_STATUSES.has(scope.status) ? scope.status : "";
  const limit = Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 100));
  const offset = Math.max(0, Number.parseInt(scope.offset, 10) || 0);
  const rows = db.prepare(listSql({ status })).all({
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    status,
    limit,
    offset
  }).map(parseRule);
  return { rows, limit, offset };
}

export function update(data = {}) {
  const payload = normalize(data);
  statements.update.run(payload);
  return getById({ tenantId: payload.tenantId, branchId: payload.branchId, id: payload.id });
}

export function updateStatus(scope = {}) {
  const status = VALID_STATUSES.has(scope.status) ? scope.status : "draft";
  return statements.updateStatus.run({ ...scope, status }).changes;
}

export function remove(scope = {}) {
  return statements.remove.run(scope).changes;
}

export function getActiveRules(scope = {}) {
  const today = scope.currentDate || new Date().toISOString().slice(0, 10);
  return statements.activeRules.all({ tenantId: scope.tenantId, branchId: scope.branchId, today }).map(parseRule);
}

export const discountRulesRepo = {
  create,
  getById,
  list,
  update,
  updateStatus,
  remove,
  getActiveRules
};
