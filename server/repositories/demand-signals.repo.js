import { db } from "../db.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS demandSignals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    signalDate TEXT NOT NULL,
    dayOfWeek TEXT NOT NULL,
    hourSlot INTEGER NOT NULL,
    slotsAvailable INTEGER NOT NULL DEFAULT 0,
    slotsBooked INTEGER NOT NULL DEFAULT 0,
    occupancyRate REAL NOT NULL DEFAULT 0,
    activeDiscountPct INTEGER NOT NULL DEFAULT 0,
    bookingsInSlot INTEGER NOT NULL DEFAULT 0,
    revenueInSlotPaise INTEGER NOT NULL DEFAULT 0,
    walkInsInSlot INTEGER NOT NULL DEFAULT 0,
    noShowsInSlot INTEGER NOT NULL DEFAULT 0,
    weatherCondition TEXT DEFAULT NULL,
    isFestivalPeriod INTEGER NOT NULL DEFAULT 0,
    isWeekend INTEGER NOT NULL DEFAULT 0,
    capturedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_demandSignals
    ON demandSignals(tenantId, branchId, signalDate, hourSlot);
`);

const insertSignal = db.prepare(`
  INSERT INTO demandSignals (
    tenantId, branchId, signalDate, dayOfWeek, hourSlot,
    slotsAvailable, slotsBooked, occupancyRate, activeDiscountPct,
    bookingsInSlot, revenueInSlotPaise, walkInsInSlot, noShowsInSlot,
    weatherCondition, isFestivalPeriod, isWeekend
  )
  VALUES (
    @tenantId, @branchId, @signalDate, @dayOfWeek, @hourSlot,
    @slotsAvailable, @slotsBooked, @occupancyRate, @activeDiscountPct,
    @bookingsInSlot, @revenueInSlotPaise, @walkInsInSlot, @noShowsInSlot,
    @weatherCondition, @isFestivalPeriod, @isWeekend
  )
`);

const exportRows = db.prepare(`
  SELECT *
  FROM demandSignals
  WHERE tenantId = @tenantId
    AND branchId = @branchId
    AND (@from IS NULL OR signalDate >= @from)
    AND (@to IS NULL OR signalDate <= @to)
  ORDER BY signalDate ASC, hourSlot ASC, capturedAt ASC
`);

const heatmapRows = db.prepare(`
  SELECT
    dayOfWeek,
    hourSlot,
    COUNT(*) AS sampleCount,
    ROUND(AVG(occupancyRate), 4) AS occupancyRate,
    SUM(slotsAvailable) AS slotsAvailable,
    SUM(slotsBooked) AS slotsBooked,
    SUM(bookingsInSlot) AS bookingsInSlot,
    SUM(revenueInSlotPaise) AS revenueInSlotPaise,
    MAX(activeDiscountPct) AS maxActiveDiscountPct
  FROM demandSignals
  WHERE tenantId = @tenantId
    AND branchId = @branchId
    AND (@from IS NULL OR signalDate >= @from)
    AND (@to IS NULL OR signalDate <= @to)
  GROUP BY dayOfWeek, hourSlot
  ORDER BY
    CASE dayOfWeek
      WHEN 'mon' THEN 1 WHEN 'tue' THEN 2 WHEN 'wed' THEN 3 WHEN 'thu' THEN 4
      WHEN 'fri' THEN 5 WHEN 'sat' THEN 6 WHEN 'sun' THEN 7 ELSE 8
    END,
    hourSlot ASC
`);

function safeColumns(tableName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) return [];
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  } catch {
    return [];
  }
}

function tableExists(tableName) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
  } catch {
    return false;
  }
}

function column(columns, candidates) {
  return candidates.find((candidate) => columns.includes(candidate)) || "";
}

function q(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Unsafe identifier");
  return `"${identifier}"`;
}

function currentSlot(date = new Date()) {
  const { nowDate, nowDay, nowTime } = happyHoursEngine.getISTComponents(date);
  return {
    signalDate: nowDate,
    dayOfWeek: nowDay,
    hourSlot: Number.parseInt(nowTime.slice(0, 2), 10) || 0
  };
}

function dateForSlot(signalDate, hourSlot) {
  const hour = String(Math.max(0, Math.min(23, Number.parseInt(hourSlot, 10) || 0))).padStart(2, "0");
  return new Date(`${signalDate}T${hour}:00:00+05:30`);
}

function appointmentMetrics({ tenantId, branchId, signalDate, hourSlot }) {
  if (!tableExists("appointments")) return { slotsBooked: 0, bookingsInSlot: 0, walkInsInSlot: 0, noShowsInSlot: 0, revenueInSlotPaise: 0 };
  const columns = safeColumns("appointments");
  const tenantCol = column(columns, ["tenantId", "tenant_id"]);
  const branchCol = column(columns, ["branchId", "branch_id"]);
  const startCol = column(columns, ["startAt", "start_at", "appointmentStart", "appointment_start"]);
  if (!tenantCol || !branchCol || !startCol) return { slotsBooked: 0, bookingsInSlot: 0, walkInsInSlot: 0, noShowsInSlot: 0, revenueInSlotPaise: 0 };

  const statusCol = column(columns, ["status", "appointmentStatus"]);
  const sourceCol = column(columns, ["source", "bookingSource"]);
  const revenueCol = column(columns, ["revenueInSlotPaise", "totalPaise", "grandTotalPaise", "amountPaise"]);
  const hour = String(Number.parseInt(hourSlot, 10) || 0).padStart(2, "0");
  const bookedWhere = statusCol ? `AND COALESCE(${q(statusCol)}, '') NOT IN ('cancelled','canceled','no_show')` : "";
  const noShowExpr = statusCol ? `SUM(CASE WHEN ${q(statusCol)} = 'no_show' THEN 1 ELSE 0 END)` : "0";
  const walkInExpr = sourceCol ? `SUM(CASE WHEN ${q(sourceCol)} IN ('walkin','walk_in','walk-in') THEN 1 ELSE 0 END)` : "0";
  const revenueExpr = revenueCol ? `SUM(COALESCE(${q(revenueCol)}, 0))` : "0";

  try {
    const row = db.prepare(`
      SELECT
        SUM(CASE WHEN 1=1 ${bookedWhere} THEN 1 ELSE 0 END) AS slotsBooked,
        SUM(CASE WHEN 1=1 ${bookedWhere} THEN 1 ELSE 0 END) AS bookingsInSlot,
        ${walkInExpr} AS walkInsInSlot,
        ${noShowExpr} AS noShowsInSlot,
        ${revenueExpr} AS revenueInSlotPaise
      FROM appointments
      WHERE ${q(tenantCol)} = @tenantId
        AND ${q(branchCol)} = @branchId
        AND substr(${q(startCol)}, 1, 10) = @signalDate
        AND substr(${q(startCol)}, 12, 2) = @hour
    `).get({ tenantId, branchId, signalDate, hour });
    return {
      slotsBooked: Number(row?.slotsBooked || 0),
      bookingsInSlot: Number(row?.bookingsInSlot || 0),
      walkInsInSlot: Number(row?.walkInsInSlot || 0),
      noShowsInSlot: Number(row?.noShowsInSlot || 0),
      revenueInSlotPaise: Math.max(0, Math.round(Number(row?.revenueInSlotPaise || 0)))
    };
  } catch {
    return { slotsBooked: 0, bookingsInSlot: 0, walkInsInSlot: 0, noShowsInSlot: 0, revenueInSlotPaise: 0 };
  }
}

function activeStaffCount({ tenantId, branchId }) {
  for (const tableName of ["staff", "staffMembers", "employees"]) {
    if (!tableExists(tableName)) continue;
    const columns = safeColumns(tableName);
    const tenantCol = column(columns, ["tenantId", "tenant_id"]);
    const branchCol = column(columns, ["branchId", "branch_id"]);
    if (!tenantCol || !branchCol) continue;
    const statusCol = column(columns, ["status", "employmentStatus"]);
    const activeCol = column(columns, ["active", "isActive"]);
    const statusWhere = statusCol ? `AND COALESCE(${q(statusCol)}, '') NOT IN ('inactive','archived','terminated')` : "";
    const activeWhere = activeCol ? `AND COALESCE(${q(activeCol)}, 1) != 0` : "";
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM ${q(tableName)}
        WHERE ${q(tenantCol)} = @tenantId
          AND ${q(branchCol)} = @branchId
          ${statusWhere}
          ${activeWhere}
      `).get({ tenantId, branchId });
      if (Number(row?.count || 0) > 0) return Number(row.count);
    } catch {
      return 0;
    }
  }
  return 0;
}

function activeDiscountPct({ tenantId, branchId, signalDate, hourSlot }) {
  try {
    const offers = happyHoursEngine.getActiveHappyHours({
      tenantId,
      branchId,
      date: dateForSlot(signalDate, hourSlot)
    });
    return Math.max(0, ...offers
      .filter((offer) => offer.discountType === "percent")
      .map((offer) => Number.parseInt(offer.discountValue, 10) || 0));
  } catch {
    return 0;
  }
}

function normalizeSignal(data = {}) {
  const slot = currentSlot(data.date ? new Date(data.date) : undefined);
  const signalDate = data.signalDate || slot.signalDate;
  const dayOfWeek = data.dayOfWeek || happyHoursEngine.getISTComponents(dateForSlot(signalDate, data.hourSlot ?? slot.hourSlot)).nowDay;
  const hourSlot = Math.max(0, Math.min(23, Number.parseInt(data.hourSlot ?? slot.hourSlot, 10) || 0));
  const slotsAvailable = Math.max(0, Number.parseInt(data.slotsAvailable, 10) || 0);
  const slotsBooked = Math.max(0, Number.parseInt(data.slotsBooked, 10) || 0);
  const occupancyRate = data.occupancyRate === undefined
    ? (slotsAvailable > 0 ? Math.min(1, slotsBooked / slotsAvailable) : 0)
    : Math.max(0, Math.min(1, Number(data.occupancyRate) || 0));

  return {
    tenantId: data.tenantId,
    branchId: data.branchId,
    signalDate,
    dayOfWeek,
    hourSlot,
    slotsAvailable,
    slotsBooked,
    occupancyRate,
    activeDiscountPct: Math.max(0, Math.min(100, Number.parseInt(data.activeDiscountPct, 10) || 0)),
    bookingsInSlot: Math.max(0, Number.parseInt(data.bookingsInSlot, 10) || 0),
    revenueInSlotPaise: Math.max(0, Math.round(Number(data.revenueInSlotPaise || 0))),
    walkInsInSlot: Math.max(0, Number.parseInt(data.walkInsInSlot, 10) || 0),
    noShowsInSlot: Math.max(0, Number.parseInt(data.noShowsInSlot, 10) || 0),
    weatherCondition: data.weatherCondition || null,
    isFestivalPeriod: data.isFestivalPeriod ? 1 : 0,
    isWeekend: data.isWeekend === undefined ? (["sat", "sun"].includes(dayOfWeek) ? 1 : 0) : (data.isWeekend ? 1 : 0)
  };
}

export function captureSnapshot({ tenantId, branchId, date } = {}) {
  const slot = currentSlot(date ? new Date(date) : new Date());
  const metrics = appointmentMetrics({ tenantId, branchId, ...slot });
  const staffCapacity = activeStaffCount({ tenantId, branchId }) * 2;
  const slotsAvailable = Math.max(staffCapacity, metrics.slotsBooked);
  const occupancyRate = slotsAvailable > 0 ? Math.min(1, metrics.slotsBooked / slotsAvailable) : 0;
  const payload = normalizeSignal({
    tenantId,
    branchId,
    ...slot,
    ...metrics,
    slotsAvailable,
    occupancyRate,
    activeDiscountPct: activeDiscountPct({ tenantId, branchId, ...slot })
  });
  const result = insertSignal.run(payload);
  return { ...payload, id: Number(result.lastInsertRowid) };
}

export function recordOutcome(data = {}) {
  const payload = normalizeSignal(data);
  const result = insertSignal.run(payload);
  return { ...payload, id: Number(result.lastInsertRowid) };
}

export function exportTrainingData({ tenantId, branchId, from = null, to = null } = {}) {
  return exportRows.all({ tenantId, branchId, from, to });
}

export function heatmap({ tenantId, branchId, from = null, to = null } = {}) {
  return heatmapRows.all({ tenantId, branchId, from, to }).map((row) => ({
    ...row,
    sampleCount: Number(row.sampleCount || 0),
    hourSlot: Number(row.hourSlot || 0),
    occupancyRate: Number(row.occupancyRate || 0),
    slotsAvailable: Number(row.slotsAvailable || 0),
    slotsBooked: Number(row.slotsBooked || 0),
    bookingsInSlot: Number(row.bookingsInSlot || 0),
    revenueInSlotPaise: Number(row.revenueInSlotPaise || 0),
    maxActiveDiscountPct: Number(row.maxActiveDiscountPct || 0)
  }));
}

function addScope(scopes, row = {}, tenantKey = "tenantId", branchKey = "branchId") {
  const tenantId = row[tenantKey];
  const branchId = row[branchKey];
  if (tenantId && branchId) scopes.set(`${tenantId}:${branchId}`, { tenantId, branchId });
}

function collectScopesFromTable(scopes, tableName, tenantCandidates, branchCandidates) {
  if (!tableExists(tableName)) return;
  const columns = safeColumns(tableName);
  const tenantCol = column(columns, tenantCandidates);
  const branchCol = column(columns, branchCandidates);
  if (!tenantCol || !branchCol) return;
  try {
    db.prepare(`
      SELECT DISTINCT ${q(tenantCol)} AS tenantId, ${q(branchCol)} AS branchId
      FROM ${q(tableName)}
      WHERE ${q(tenantCol)} IS NOT NULL AND ${q(branchCol)} IS NOT NULL
      LIMIT 500
    `).all().forEach((row) => addScope(scopes, row));
  } catch {
    // best effort only
  }
}

export function listCaptureScopes() {
  const scopes = new Map();
  collectScopesFromTable(scopes, "happyHours", ["tenantId", "tenant_id"], ["branchId", "branch_id"]);
  collectScopesFromTable(scopes, "appointments", ["tenantId", "tenant_id"], ["branchId", "branch_id"]);
  collectScopesFromTable(scopes, "demandSignals", ["tenantId"], ["branchId"]);
  collectScopesFromTable(scopes, "branches", ["tenantId", "tenant_id"], ["id", "branchId", "branch_id"]);
  return [...scopes.values()];
}

export function rowsToCsv(rows = []) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...rows.map((row) => columns.map((key) => escape(row[key])).join(","))].join("\n");
}

export const demandSignalsRepo = {
  captureSnapshot,
  recordOutcome,
  exportTrainingData,
  heatmap,
  listCaptureScopes,
  rowsToCsv
};
