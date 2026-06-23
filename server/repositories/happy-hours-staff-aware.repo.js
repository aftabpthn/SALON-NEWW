import { db } from "../db.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursStaffAwareSuggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    staffId TEXT NOT NULL DEFAULT '',
    staffName TEXT NOT NULL DEFAULT '',
    serviceCategory TEXT NOT NULL DEFAULT 'default',
    signalDate TEXT NOT NULL,
    dayOfWeek TEXT NOT NULL,
    hourSlot INTEGER NOT NULL DEFAULT 0,
    loadPercent REAL NOT NULL DEFAULT 0,
    occupancyRate REAL NOT NULL DEFAULT 0,
    suggestedDiscountPercent INTEGER NOT NULL DEFAULT 0,
    suggestedIncentivePercent REAL NOT NULL DEFAULT 0,
    servicePricePaise INTEGER NOT NULL DEFAULT 0,
    expectedDiscountPaise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'suggested',
    reasons TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_staffAwareSuggestions_scope
    ON happyHoursStaffAwareSuggestions(tenantId, branchId, status, createdAt);
`);

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function tableExists(tableName) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @tableName").get({ tableName }));
  } catch {
    return false;
  }
}

function safeColumns(tableName) {
  if (!tableExists(tableName)) return [];
  try {
    return db.prepare(`PRAGMA table_info("${tableName}")`).all().map((column) => column.name);
  } catch {
    return [];
  }
}

function column(columns, candidates) {
  return candidates.find((candidate) => columns.includes(candidate)) || "";
}

function q(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Unsafe identifier");
  return `"${identifier}"`;
}

function currentSlot(input = {}) {
  const date = input.signalDate ? new Date(`${String(input.signalDate).slice(0, 10)}T00:00:00+05:30`) : new Date();
  const parts = happyHoursEngine.getISTComponents(date);
  return {
    signalDate: input.signalDate || parts.nowDate,
    dayOfWeek: String(input.dayOfWeek || parts.nowDay).slice(0, 3).toLowerCase(),
    hourSlot: Math.max(0, Math.min(23, Number.parseInt(input.hourSlot ?? parts.nowTime.slice(0, 2), 10) || 0))
  };
}

function staffRoster(scope = {}) {
  const current = normalizeScope(scope);
  const requestedStaffId = String(scope.staffId || "").trim();
  for (const tableName of ["staff", "staffMembers", "employees"]) {
    const columns = safeColumns(tableName);
    if (!columns.length) continue;
    const tenantCol = column(columns, ["tenantId", "tenant_id"]);
    const branchCol = column(columns, ["branchId", "branch_id"]);
    const staffCol = column(columns, ["id", "staffId", "employeeId"]);
    const nameCol = column(columns, ["name", "fullName", "staffName", "employeeName"]);
    const statusCol = column(columns, ["status", "employmentStatus"]);
    const activeCol = column(columns, ["active", "isActive"]);
    if (!tenantCol || !branchCol || !staffCol) continue;
    const statusWhere = statusCol ? `AND COALESCE(${q(statusCol)}, '') NOT IN ('inactive','archived','terminated')` : "";
    const activeWhere = activeCol ? `AND COALESCE(${q(activeCol)}, 1) != 0` : "";
    const staffWhere = requestedStaffId ? `AND CAST(${q(staffCol)} AS TEXT) = @staffId` : "";
    try {
      const rows = db.prepare(`
        SELECT CAST(${q(staffCol)} AS TEXT) AS staffId,
               ${nameCol ? q(nameCol) : q(staffCol)} AS staffName
        FROM ${q(tableName)}
        WHERE ${q(tenantCol)} = @tenantId
          AND ${q(branchCol)} = @branchId
          ${statusWhere}
          ${activeWhere}
          ${staffWhere}
        ORDER BY staffName ASC
        LIMIT 100
      `).all({ ...current, staffId: requestedStaffId });
      if (rows.length) return rows;
    } catch {
      return [];
    }
  }
  return requestedStaffId ? [{ staffId: requestedStaffId, staffName: requestedStaffId }] : [];
}

function staffBookings(scope = {}) {
  if (!tableExists("appointments")) return 0;
  const columns = safeColumns("appointments");
  const tenantCol = column(columns, ["tenantId", "tenant_id"]);
  const branchCol = column(columns, ["branchId", "branch_id"]);
  const staffCol = column(columns, ["staffId", "staff_id", "employeeId", "employee_id"]);
  const startCol = column(columns, ["startAt", "start_at", "appointmentStart", "appointment_start"]);
  const statusCol = column(columns, ["status", "appointmentStatus"]);
  if (!tenantCol || !branchCol || !staffCol || !startCol || !scope.staffId) return 0;
  const statusWhere = statusCol ? `AND COALESCE(${q(statusCol)}, '') NOT IN ('cancelled','canceled','no_show')` : "";
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM appointments
      WHERE ${q(tenantCol)} = @tenantId
        AND ${q(branchCol)} = @branchId
        AND CAST(${q(staffCol)} AS TEXT) = @staffId
        AND substr(${q(startCol)}, 1, 10) = @signalDate
        AND substr(${q(startCol)}, 12, 2) = @hour
        ${statusWhere}
    `).get({
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      staffId: String(scope.staffId),
      signalDate: scope.signalDate,
      hour: String(scope.hourSlot).padStart(2, "0")
    });
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function demandSignal(scope = {}) {
  if (!tableExists("demandSignals")) return { occupancyRate: 0, activeDiscountPct: 0, sampleCount: 0 };
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS sampleCount,
             ROUND(AVG(occupancyRate), 4) AS occupancyRate,
             MAX(activeDiscountPct) AS activeDiscountPct
      FROM demandSignals
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND dayOfWeek = @dayOfWeek
        AND hourSlot = @hourSlot
    `).get(scope);
    return {
      occupancyRate: Number(row?.occupancyRate || 0),
      activeDiscountPct: Number(row?.activeDiscountPct || 0),
      sampleCount: Number(row?.sampleCount || 0)
    };
  } catch {
    return { occupancyRate: 0, activeDiscountPct: 0, sampleCount: 0 };
  }
}

function suggestionForStaff(input = {}, staff = {}) {
  const current = normalizeScope(input);
  const slot = currentSlot(input);
  const capacityPerHour = Math.max(1, Number.parseInt(input.capacityPerHour, 10) || 3);
  const servicePricePaise = Math.max(0, Math.round(Number(input.servicePricePaise || 0)));
  const signal = demandSignal({ ...current, ...slot });
  const bookings = staffBookings({ ...current, ...slot, staffId: staff.staffId });
  const loadPercent = Math.min(100, Math.round((bookings / capacityPerHour) * 1000) / 10);
  const lowOccupancy = signal.occupancyRate < 0.45;
  const idleStaff = loadPercent < 50;
  const overloaded = loadPercent >= 85;
  let suggestedDiscountPercent = 0;
  let suggestedIncentivePercent = 0;
  const reasons = [];

  if (overloaded) {
    reasons.push("Staff load high hai; discount push avoid karo.");
  } else if (lowOccupancy && idleStaff) {
    suggestedDiscountPercent = 15;
    suggestedIncentivePercent = 3;
    reasons.push("Low occupancy + idle staff, conversion boost useful hai.");
  } else if (lowOccupancy || idleStaff) {
    suggestedDiscountPercent = 10;
    suggestedIncentivePercent = 2;
    reasons.push("Demand/staff load soft hai; controlled offer suggest hua.");
  } else {
    suggestedDiscountPercent = 5;
    suggestedIncentivePercent = 1;
    reasons.push("Moderate load; small nudge enough hai.");
  }

  if (signal.activeDiscountPct >= suggestedDiscountPercent) {
    suggestedDiscountPercent = Math.max(0, signal.activeDiscountPct);
    reasons.push("Existing active discount already covers this slot.");
  }

  return {
    ...current,
    ...slot,
    staffId: String(staff.staffId || input.staffId || ""),
    staffName: String(staff.staffName || staff.staffId || input.staffId || ""),
    serviceCategory: String(input.serviceCategory || "default").trim() || "default",
    loadPercent,
    occupancyRate: signal.occupancyRate,
    sampleCount: signal.sampleCount,
    activeDiscountPct: signal.activeDiscountPct,
    suggestedDiscountPercent,
    suggestedIncentivePercent,
    servicePricePaise,
    expectedDiscountPaise: Math.round(servicePricePaise * (suggestedDiscountPercent / 100)),
    status: signal.sampleCount ? "ready" : "collecting",
    reasons
  };
}

export function evaluate(scope = {}) {
  const roster = staffRoster(scope);
  const rows = roster.length ? roster.map((staff) => suggestionForStaff(scope, staff)) : [suggestionForStaff(scope, {})];
  const best = [...rows].sort((a, b) =>
    b.suggestedDiscountPercent - a.suggestedDiscountPercent || a.loadPercent - b.loadPercent
  )[0];
  return {
    status: rows.some((row) => row.status === "ready") ? "ready" : "collecting",
    best,
    rows,
    summary: {
      staffCount: rows.length,
      idleCount: rows.filter((row) => row.loadPercent < 50).length,
      overloadedCount: rows.filter((row) => row.loadPercent >= 85).length,
      averageLoadPercent: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.loadPercent, 0) / rows.length) : 0
    }
  };
}

export function saveSuggestion(scope = {}) {
  const evaluation = evaluate(scope);
  const row = evaluation.best;
  if (!row) throw new Error("No staff-aware suggestion available");
  const payload = {
    ...row,
    reasons: JSON.stringify(row.reasons || []),
    status: "suggested"
  };
  const result = db.prepare(`
    INSERT INTO happyHoursStaffAwareSuggestions (
      tenantId, branchId, staffId, staffName, serviceCategory, signalDate,
      dayOfWeek, hourSlot, loadPercent, occupancyRate, suggestedDiscountPercent,
      suggestedIncentivePercent, servicePricePaise, expectedDiscountPaise,
      status, reasons
    )
    VALUES (
      @tenantId, @branchId, @staffId, @staffName, @serviceCategory, @signalDate,
      @dayOfWeek, @hourSlot, @loadPercent, @occupancyRate, @suggestedDiscountPercent,
      @suggestedIncentivePercent, @servicePricePaise, @expectedDiscountPaise,
      @status, @reasons
    )
  `).run(payload);
  return getSuggestion({ ...row, id: Number(result.lastInsertRowid) });
}

export function listSuggestions(scope = {}) {
  const current = normalizeScope(scope);
  const status = String(scope.status || "").trim();
  const limit = Math.min(100, Math.max(1, Number.parseInt(scope.limit, 10) || 25));
  return {
    rows: db.prepare(`
      SELECT *
      FROM happyHoursStaffAwareSuggestions
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND (@status = '' OR status = @status)
      ORDER BY createdAt DESC, id DESC
      LIMIT @limit
    `).all({ ...current, status, limit }).map(parseSuggestion)
  };
}

export function updateStatus(scope = {}) {
  const current = normalizeScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  const status = String(scope.status || "suggested").trim();
  db.prepare(`
    UPDATE happyHoursStaffAwareSuggestions
    SET status = @status
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).run({ ...current, id, status });
  return getSuggestion({ ...current, id });
}

function getSuggestion(scope = {}) {
  const current = normalizeScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  const row = db.prepare(`
    SELECT *
    FROM happyHoursStaffAwareSuggestions
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).get({ ...current, id });
  return parseSuggestion(row);
}

function parseSuggestion(row) {
  if (!row) return null;
  return {
    ...row,
    reasons: JSON.parse(row.reasons || "[]")
  };
}

export const happyHoursStaffAwareRepo = {
  evaluate,
  saveSuggestion,
  listSuggestions,
  updateStatus
};
