import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS flashSales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    slotDate TEXT NOT NULL,
    slotTime TEXT NOT NULL,
    staffId TEXT,
    discountPercent INTEGER NOT NULL DEFAULT 30,
    maxRedemptions INTEGER NOT NULL DEFAULT 1,
    redemptions INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    triggerReason TEXT NOT NULL DEFAULT 'empty_slot',
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_flashSales_scope ON flashSales(tenantId, branchId, status);
  CREATE INDEX IF NOT EXISTS idx_flashSales_slot ON flashSales(tenantId, branchId, slotDate, slotTime);
`);

const statements = {
  create: db.prepare(`
    INSERT INTO flashSales
      (tenantId, branchId, slotDate, slotTime, staffId, discountPercent, maxRedemptions, expiresAt, triggerReason, status)
    VALUES
      (@tenantId, @branchId, @slotDate, @slotTime, @staffId, @discountPercent, @maxRedemptions, @expiresAt, @triggerReason, 'active')
  `),
  activeForSlot: db.prepare(`
    SELECT * FROM flashSales
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND slotDate = @slotDate
      AND slotTime = @slotTime
      AND status = 'active'
      AND expiresAt > strftime('%s','now')
    ORDER BY discountPercent DESC, createdAt DESC
    LIMIT 1
  `),
  listActive: db.prepare(`
    SELECT * FROM flashSales
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
      AND expiresAt > strftime('%s','now')
    ORDER BY slotDate ASC, slotTime ASC
  `),
  redeem: db.prepare(`
    UPDATE flashSales
    SET redemptions = redemptions + 1,
        status = CASE WHEN redemptions + 1 >= maxRedemptions THEN 'redeemed' ELSE status END
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId AND status = 'active'
  `),
  expireOld: db.prepare(`
    UPDATE flashSales
    SET status = 'expired'
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
      AND expiresAt < strftime('%s','now')
  `)
};

export function create(data = {}) {
  const payload = {
    tenantId: data.tenantId,
    branchId: data.branchId,
    slotDate: data.slotDate,
    slotTime: data.slotTime,
    staffId: data.staffId || null,
    discountPercent: Math.max(1, Number.parseInt(data.discountPercent, 10) || 30),
    maxRedemptions: Math.max(1, Number.parseInt(data.maxRedemptions, 10) || 1),
    expiresAt: Math.max(0, Number.parseInt(data.expiresAt, 10) || 0),
    triggerReason: data.triggerReason || "empty_slot"
  };
  const result = statements.create.run(payload);
  return { ...payload, id: Number(result.lastInsertRowid), redemptions: 0, status: "active" };
}

export function getActiveForSlot(scope = {}) {
  return statements.activeForSlot.get(scope) || null;
}

export function listActive(scope = {}) {
  return statements.listActive.all(scope);
}

export function redeem(scope = {}) {
  return statements.redeem.run(scope).changes;
}

export function expireOld(scope = {}) {
  return statements.expireOld.run(scope).changes;
}

export const flashSaleRepo = {
  create,
  getActiveForSlot,
  listActive,
  redeem,
  expireOld
};
