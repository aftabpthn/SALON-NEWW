import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    dayOfWeek TEXT NOT NULL DEFAULT 'everyday',
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    discountType TEXT NOT NULL DEFAULT 'percent',
    discountValue INTEGER NOT NULL DEFAULT 0,
    applicableTo TEXT NOT NULL DEFAULT 'all',
    maxDiscountPaise INTEGER DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 1,
    stackable INTEGER NOT NULL DEFAULT 0,
    validFrom TEXT DEFAULT NULL,
    validTo TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_happyHours_scope ON happyHours(tenantId, branchId);
  CREATE INDEX IF NOT EXISTS idx_happyHours_status ON happyHours(tenantId, branchId, status);

  CREATE TABLE IF NOT EXISTS happyHoursServices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    happyHourId INTEGER NOT NULL REFERENCES happyHours(id) ON DELETE CASCADE,
    serviceId TEXT NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(happyHourId, serviceId, tenantId, branchId)
  );

  CREATE INDEX IF NOT EXISTS idx_hhServices_scope ON happyHoursServices(tenantId, branchId, happyHourId);

  CREATE TABLE IF NOT EXISTS happyHoursAudit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    invoiceId TEXT NOT NULL,
    happyHourId INTEGER NOT NULL,
    happyHourName TEXT NOT NULL,
    totalDiscountPaise INTEGER NOT NULL DEFAULT 0,
    appliedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hhAudit_invoice ON happyHoursAudit(tenantId, branchId, invoiceId);
  CREATE INDEX IF NOT EXISTS idx_hhAudit_hh ON happyHoursAudit(tenantId, branchId, happyHourId);
`);

const statements = {
  insert: db.prepare(`
    INSERT INTO happyHours (
      tenantId, branchId, name, description, dayOfWeek, startTime, endTime,
      discountType, discountValue, applicableTo, maxDiscountPaise, priority,
      stackable, validFrom, validTo, status
    ) VALUES (
      @tenantId, @branchId, @name, @description, @dayOfWeek, @startTime, @endTime,
      @discountType, @discountValue, @applicableTo, @maxDiscountPaise, @priority,
      @stackable, @validFrom, @validTo, @status
    )
  `),
  byId: db.prepare(`
    SELECT * FROM happyHours
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  list: db.prepare(`
    SELECT * FROM happyHours
    WHERE tenantId = @tenantId AND branchId = @branchId
    ORDER BY priority DESC, createdAt DESC
    LIMIT @limit OFFSET @offset
  `),
  listByStatus: db.prepare(`
    SELECT * FROM happyHours
    WHERE tenantId = @tenantId AND branchId = @branchId AND status = @status
    ORDER BY priority DESC, createdAt DESC
    LIMIT @limit OFFSET @offset
  `),
  count: db.prepare(`
    SELECT COUNT(*) AS total FROM happyHours
    WHERE tenantId = @tenantId AND branchId = @branchId
  `),
  countByStatus: db.prepare(`
    SELECT COUNT(*) AS total FROM happyHours
    WHERE tenantId = @tenantId AND branchId = @branchId AND status = @status
  `),
  update: db.prepare(`
    UPDATE happyHours
    SET name = @name,
        description = @description,
        dayOfWeek = @dayOfWeek,
        startTime = @startTime,
        endTime = @endTime,
        discountType = @discountType,
        discountValue = @discountValue,
        applicableTo = @applicableTo,
        maxDiscountPaise = @maxDiscountPaise,
        priority = @priority,
        stackable = @stackable,
        validFrom = @validFrom,
        validTo = @validTo,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  toggleStatus: db.prepare(`
    UPDATE happyHours
    SET status = @status,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  del: db.prepare(`
    DELETE FROM happyHours
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  insertService: db.prepare(`
    INSERT OR IGNORE INTO happyHoursServices (tenantId, branchId, happyHourId, serviceId)
    VALUES (@tenantId, @branchId, @happyHourId, @serviceId)
  `),
  deleteServicesByHH: db.prepare(`
    DELETE FROM happyHoursServices
    WHERE happyHourId = @happyHourId AND tenantId = @tenantId AND branchId = @branchId
  `),
  getServicesByHH: db.prepare(`
    SELECT * FROM happyHoursServices
    WHERE happyHourId = @happyHourId AND tenantId = @tenantId AND branchId = @branchId
  `),
  activeNow: db.prepare(`
    SELECT * FROM happyHours
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
      AND startTime <= @nowTime
      AND endTime > @nowTime
      AND (dayOfWeek = 'everyday' OR dayOfWeek LIKE '%' || @nowDay || '%')
      AND (validFrom IS NULL OR validFrom <= @nowDate)
      AND (validTo IS NULL OR validTo >= @nowDate)
    ORDER BY priority DESC
  `),
  insertAudit: db.prepare(`
    INSERT INTO happyHoursAudit
      (tenantId, branchId, invoiceId, happyHourId, happyHourName, totalDiscountPaise)
    VALUES
      (@tenantId, @branchId, @invoiceId, @happyHourId, @happyHourName, @totalDiscountPaise)
  `),
  auditByInvoice: db.prepare(`
    SELECT * FROM happyHoursAudit
    WHERE invoiceId = @invoiceId AND tenantId = @tenantId AND branchId = @branchId
  `)
};

function normalizeHappyHour(data = {}) {
  const discountType = data.discountType === "flat" ? "flat" : "percent";
  const rawDiscountValue = Math.max(0, Number.parseInt(data.discountValue, 10) || 0);
  return {
    tenantId: data.tenantId,
    branchId: data.branchId,
    name: String(data.name || "").trim(),
    description: data.description ? String(data.description) : "",
    dayOfWeek: data.dayOfWeek ? String(data.dayOfWeek) : "everyday",
    startTime: data.startTime ? String(data.startTime) : "",
    endTime: data.endTime ? String(data.endTime) : "",
    discountType,
    discountValue: discountType === "percent" ? Math.min(rawDiscountValue, 100) : rawDiscountValue,
    applicableTo: ["all", "services", "categories"].includes(data.applicableTo) ? data.applicableTo : "all",
    maxDiscountPaise: Math.max(0, Number.parseInt(data.maxDiscountPaise, 10) || 0),
    priority: Number.parseInt(data.priority, 10) || 1,
    stackable: data.stackable ? 1 : 0,
    validFrom: data.validFrom || null,
    validTo: data.validTo || null,
    status: data.status === "inactive" ? "inactive" : "active"
  };
}

function normalizePage(scope = {}) {
  return {
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    status: scope.status,
    limit: Math.min(Math.max(Number.parseInt(scope.limit, 10) || 100, 1), 500),
    offset: Math.max(Number.parseInt(scope.offset, 10) || 0, 0)
  };
}

function attachServices(row) {
  if (!row) return null;
  return {
    ...row,
    services: statements.getServicesByHH.all({
      tenantId: row.tenantId,
      branchId: row.branchId,
      happyHourId: row.id
    })
  };
}

function replaceServices({ tenantId, branchId, happyHourId, serviceIds = [] }) {
  statements.deleteServicesByHH.run({ tenantId, branchId, happyHourId });
  for (const rawId of serviceIds) {
    const serviceId = String(rawId || "").trim();
    if (serviceId) {
      statements.insertService.run({ tenantId, branchId, happyHourId, serviceId });
    }
  }
}

const createTx = db.transaction((data) => {
  const payload = normalizeHappyHour(data);
  const result = statements.insert.run(payload);
  const happyHourId = Number(result.lastInsertRowid);
  if (Array.isArray(data.serviceIds)) {
    replaceServices({ tenantId: payload.tenantId, branchId: payload.branchId, happyHourId, serviceIds: data.serviceIds });
  }
  return getById({ tenantId: payload.tenantId, branchId: payload.branchId, id: happyHourId });
});

const updateTx = db.transaction((data) => {
  const current = statements.byId.get(data);
  if (!current) return null;
  const payload = normalizeHappyHour({ ...current, ...data, status: current.status });
  const updatePayload = { ...payload, id: data.id };
  statements.update.run(updatePayload);
  if (Array.isArray(data.serviceIds)) {
    replaceServices({ tenantId: payload.tenantId, branchId: payload.branchId, happyHourId: data.id, serviceIds: data.serviceIds });
  }
  return getById({ tenantId: payload.tenantId, branchId: payload.branchId, id: data.id });
});

export function create(data) {
  return createTx(data);
}

export function getById(scope) {
  return attachServices(statements.byId.get(scope));
}

export function list(scope) {
  const page = normalizePage(scope);
  const useStatus = page.status === "active" || page.status === "inactive";
  const rows = (useStatus ? statements.listByStatus : statements.list).all(page).map(attachServices);
  const total = Number((useStatus ? statements.countByStatus : statements.count).get(page)?.total || 0);
  return { rows, total };
}

export function update(data) {
  return updateTx(data);
}

export function toggleStatus(scope) {
  const status = scope.status === "inactive" ? "inactive" : "active";
  const result = statements.toggleStatus.run({ ...scope, status });
  return { changes: result.changes, row: result.changes ? getById(scope) : null };
}

export function remove(scope) {
  return statements.del.run(scope).changes;
}

export function getActiveNow(scope) {
  return statements.activeNow.all(scope).map(attachServices);
}

export function recordAudit(data) {
  return statements.insertAudit.run(data);
}

export function getAuditByInvoice(scope) {
  return statements.auditByInvoice.all(scope);
}

export const happyHoursRepo = {
  create,
  getById,
  list,
  update,
  toggleStatus,
  remove,
  getActiveNow,
  recordAudit,
  getAuditByInvoice
};
