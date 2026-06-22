import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS discountSimulations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    contextJson TEXT NOT NULL DEFAULT '{}',
    cartJson TEXT NOT NULL DEFAULT '[]',
    resultJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'saved',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_discountSimulations_scope ON discountSimulations(tenantId, branchId, createdAt);
`);

const statements = {
  insert: db.prepare(`
    INSERT INTO discountSimulations (
      tenantId, branchId, name, contextJson, cartJson, resultJson, status, createdBy
    )
    VALUES (
      @tenantId, @branchId, @name, @contextJson, @cartJson, @resultJson, @status, @createdBy
    )
  `),
  list: db.prepare(`
    SELECT * FROM discountSimulations
    WHERE tenantId = @tenantId
      AND branchId = @branchId
    ORDER BY createdAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `),
  getById: db.prepare(`
    SELECT * FROM discountSimulations
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
    LIMIT 1
  `),
  deleteById: db.prepare(`
    DELETE FROM discountSimulations
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
  `)
};

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonText(value, fallback) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value);
}

function normalize(data = {}) {
  const name = String(data.name || "Discount simulation").trim();
  if (!name) throw new Error("name is required");
  return {
    ...requireScope(data),
    name,
    contextJson: jsonText(data.context ?? data.contextJson, {}),
    cartJson: jsonText(data.cartItems ?? data.cart ?? data.cartJson, []),
    resultJson: jsonText(data.result ?? data.resultJson, {}),
    status: String(data.status || "saved").trim() || "saved",
    createdBy: data.createdBy || null
  };
}

function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    context: parseJson(row.contextJson, {}),
    cartItems: parseJson(row.cartJson, []),
    result: parseJson(row.resultJson, {})
  };
}

export function saveSimulation(data = {}) {
  const payload = normalize(data);
  const result = statements.insert.run(payload);
  return getSimulation({ ...payload, id: Number(result.lastInsertRowid) });
}

export function listSimulations(scope = {}) {
  const current = requireScope(scope);
  const limit = Math.min(100, Math.max(1, Number.parseInt(scope.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(scope.offset, 10) || 0);
  return {
    rows: statements.list.all({ ...current, limit, offset }).map(parseRow),
    limit,
    offset
  };
}

export function getSimulation(scope = {}) {
  const current = requireScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  if (!id) throw new Error("valid simulation id is required");
  return parseRow(statements.getById.get({ ...current, id }));
}

export function deleteSimulation(scope = {}) {
  const current = requireScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  if (!id) throw new Error("valid simulation id is required");
  return statements.deleteById.run({ ...current, id }).changes;
}

export const discountSimulationsRepo = {
  saveSimulation,
  listSimulations,
  getSimulation,
  deleteSimulation
};
