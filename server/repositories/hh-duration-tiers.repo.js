import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS hhDurationTiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    happyHourId INTEGER NOT NULL REFERENCES happyHours(id) ON DELETE CASCADE,
    minDurationMins INTEGER NOT NULL,
    maxDurationMins INTEGER,
    bonusPercent INTEGER NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hhDurTiers ON hhDurationTiers(tenantId, branchId, happyHourId);
`);

const statements = {
  create: db.prepare(`
    INSERT INTO hhDurationTiers (tenantId, branchId, happyHourId, minDurationMins, maxDurationMins, bonusPercent)
    VALUES (@tenantId, @branchId, @happyHourId, @minDurationMins, @maxDurationMins, @bonusPercent)
  `),
  list: db.prepare(`
    SELECT * FROM hhDurationTiers
    WHERE tenantId = @tenantId AND branchId = @branchId AND happyHourId = @happyHourId
    ORDER BY minDurationMins ASC
  `),
  remove: db.prepare(`
    DELETE FROM hhDurationTiers
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId AND happyHourId = @happyHourId
  `)
};

export function create(data = {}) {
  const payload = {
    tenantId: data.tenantId,
    branchId: data.branchId,
    happyHourId: Number.parseInt(data.happyHourId, 10),
    minDurationMins: Math.max(0, Number.parseInt(data.minDurationMins, 10) || 0),
    maxDurationMins: data.maxDurationMins === null || data.maxDurationMins === "" || data.maxDurationMins === undefined
      ? null
      : Math.max(0, Number.parseInt(data.maxDurationMins, 10) || 0),
    bonusPercent: Math.max(0, Number.parseInt(data.bonusPercent, 10) || 0)
  };
  const result = statements.create.run(payload);
  return { ...payload, id: Number(result.lastInsertRowid) };
}

export function list(scope = {}) {
  return statements.list.all(scope);
}

export function remove(scope = {}) {
  return statements.remove.run(scope).changes;
}

export const hhDurationTiersRepo = { create, list, remove };
