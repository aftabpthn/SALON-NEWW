import { db } from "../db.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursLeadTimeSuggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    leadTimeBucket TEXT NOT NULL DEFAULT 'same_day',
    serviceCategory TEXT NOT NULL DEFAULT 'default',
    signalDate TEXT NOT NULL,
    dayOfWeek TEXT NOT NULL DEFAULT '',
    hourSlot INTEGER NOT NULL DEFAULT 0,
    requestedStartAt TEXT NOT NULL DEFAULT '',
    bookingLeadMinutes INTEGER NOT NULL DEFAULT 0,
    servicePricePaise INTEGER NOT NULL DEFAULT 0,
    baseDiscountPercent REAL NOT NULL DEFAULT 0,
    occupancyRate REAL NOT NULL DEFAULT 0,
    sampleCount INTEGER NOT NULL DEFAULT 0,
    historicalBookingCount INTEGER NOT NULL DEFAULT 0,
    historicalRevenuePaise INTEGER NOT NULL DEFAULT 0,
    avgHistoricalLeadMinutes INTEGER NOT NULL DEFAULT 0,
    noShowRatePercent REAL NOT NULL DEFAULT 0,
    slotFillPressure TEXT NOT NULL DEFAULT 'unknown',
    urgencyRisk TEXT NOT NULL DEFAULT 'unknown',
    campaignAngle TEXT NOT NULL DEFAULT 'collect_lead_time_data',
    suggestedDiscountPercent INTEGER NOT NULL DEFAULT 0,
    expectedDiscountPaise INTEGER NOT NULL DEFAULT 0,
    expectedRevenuePaise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'suggested',
    reasons TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_leadTimeSuggestions_scope
    ON happyHoursLeadTimeSuggestions(tenantId, branchId, status, leadTimeBucket, createdAt);
`);

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function cleanCategory(value) {
  return String(value || "default").trim().toLowerCase() || "default";
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function percent(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function q(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Unsafe identifier");
  return `"${identifier}"`;
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
    return db.prepare(`PRAGMA table_info(${q(tableName)})`).all().map((column) => column.name);
  } catch {
    return [];
  }
}

function column(columns, candidates) {
  return candidates.find((candidate) => columns.includes(candidate)) || "";
}

function slot(input = {}) {
  const requestedStartAt = String(input.requestedStartAt || "").trim();
  const start = requestedStartAt ? new Date(requestedStartAt) : null;
  const date = start && Number.isFinite(start.getTime())
    ? start
    : input.signalDate
      ? new Date(`${String(input.signalDate).slice(0, 10)}T00:00:00+05:30`)
      : new Date();
  const parts = happyHoursEngine.getISTComponents(date);
  const hour = Number.isFinite(start?.getTime()) ? start.getHours() : Number.parseInt(input.hourSlot ?? parts.nowTime.slice(0, 2), 10);
  return {
    signalDate: String(input.signalDate || parts.nowDate).slice(0, 10),
    dayOfWeek: String(input.dayOfWeek || parts.nowDay).slice(0, 3).toLowerCase(),
    hourSlot: Math.max(0, Math.min(23, hour || 0)),
    requestedStartAt
  };
}

function daysAgo(dateText, days) {
  const date = new Date(`${String(dateText).slice(0, 10)}T00:00:00+05:30`);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function requestedStartFromSlot(currentSlot) {
  return `${currentSlot.signalDate}T${String(currentSlot.hourSlot).padStart(2, "0")}:00:00+05:30`;
}

function bookingLeadMinutes(input = {}, currentSlot = {}) {
  const manual = Number.parseInt(input.bookingLeadMinutes, 10);
  if (Number.isFinite(manual) && manual >= 0) return Math.min(60 * 24 * 90, manual);
  const target = new Date(currentSlot.requestedStartAt || requestedStartFromSlot(currentSlot));
  const diff = Math.round((target.getTime() - Date.now()) / 60000);
  return Math.max(0, Math.min(60 * 24 * 90, Number.isFinite(diff) ? diff : 0));
}

function leadBucket(minutes) {
  if (minutes <= 120) return "urgent_2h";
  if (minutes <= 480) return "same_day";
  if (minutes <= 1440) return "next_day";
  if (minutes <= 4320) return "short_notice";
  if (minutes <= 10080) return "standard_week";
  return "advance";
}

function bucketRange(bucket) {
  if (bucket === "urgent_2h") return { minLead: 0, maxLead: 120 };
  if (bucket === "same_day") return { minLead: 121, maxLead: 480 };
  if (bucket === "next_day") return { minLead: 481, maxLead: 1440 };
  if (bucket === "short_notice") return { minLead: 1441, maxLead: 4320 };
  if (bucket === "standard_week") return { minLead: 4321, maxLead: 10080 };
  return { minLead: 10081, maxLead: 129600 };
}

function demandContext(scope = {}) {
  if (!tableExists("demandSignals")) return { occupancyRate: 0, sampleCount: 0 };
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS sampleCount,
             ROUND(AVG(occupancyRate), 4) AS occupancyRate
      FROM demandSignals
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND dayOfWeek = @dayOfWeek
        AND hourSlot = @hourSlot
    `).get(scope);
    return {
      occupancyRate: Number(row?.occupancyRate || 0),
      sampleCount: Number(row?.sampleCount || 0)
    };
  } catch {
    return { occupancyRate: 0, sampleCount: 0 };
  }
}

function leadStatsFromTable(tableName, input = {}) {
  const columns = safeColumns(tableName);
  if (!columns.length) {
    return { bookingCount: 0, revenuePaise: 0, avgLeadMinutes: 0, noShowCount: 0 };
  }
  const tenantCol = column(columns, ["tenantId", "tenant_id"]);
  const branchCol = column(columns, ["branchId", "branch_id"]);
  const startCol = column(columns, ["startAt", "appointmentDate", "scheduledFor", "slotStartAt", "startTime", "date"]);
  const createdCol = column(columns, ["createdAt", "created_at", "bookedAt", "bookingCreatedAt", "scheduledAt"]);
  const categoryCol = column(columns, ["serviceCategory", "category"]);
  const statusCol = column(columns, ["status", "appointmentStatus", "bookingStatus"]);
  const amountCol = column(columns, ["grandTotalPaise", "netTotalPaise", "totalPaise", "amountPaise", "revenuePaise", "totalAmount"]);
  if (!tenantCol || !branchCol || !startCol) {
    return { bookingCount: 0, revenuePaise: 0, avgLeadMinutes: 0, noShowCount: 0 };
  }

  const categoryWhere = categoryCol && input.serviceCategory !== "default"
    ? `AND LOWER(CAST(${q(categoryCol)} AS TEXT)) = @serviceCategory`
    : "";
  const dateWhere = `AND substr(CAST(${q(startCol)} AS TEXT), 1, 10) >= @fromDate`;
  const leadExpr = createdCol
    ? `ROUND((julianday(CAST(${q(startCol)} AS TEXT)) - CASE WHEN typeof(${q(createdCol)}) IN ('integer','real') THEN julianday(datetime(${q(createdCol)}, 'unixepoch')) ELSE julianday(CAST(${q(createdCol)} AS TEXT)) END) * 1440)`
    : "";
  const leadWhere = leadExpr ? `AND ${leadExpr} >= @minLead AND ${leadExpr} < @maxLead` : "";
  const statusExpr = statusCol ? `LOWER(COALESCE(CAST(${q(statusCol)} AS TEXT), ''))` : "''";
  const statusWhere = statusCol ? `AND ${statusExpr} NOT IN ('deleted','void','refunded')` : "";

  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS bookingCount,
             COALESCE(SUM(${amountCol ? q(amountCol) : "0"}), 0) AS revenuePaise,
             ${leadExpr ? `COALESCE(AVG(${leadExpr}), 0)` : "0"} AS avgLeadMinutes,
             SUM(CASE WHEN ${statusExpr} IN ('no_show','noshow','cancelled','canceled') THEN 1 ELSE 0 END) AS noShowCount
      FROM ${q(tableName)}
      WHERE ${q(tenantCol)} = @tenantId
        AND ${q(branchCol)} = @branchId
        ${categoryWhere}
        ${dateWhere}
        ${leadWhere}
        ${statusWhere}
    `).get(input);
    return {
      bookingCount: Number(row?.bookingCount || 0),
      revenuePaise: intPaise(row?.revenuePaise || 0),
      avgLeadMinutes: Math.max(0, Math.round(Number(row?.avgLeadMinutes || 0))),
      noShowCount: Number(row?.noShowCount || 0)
    };
  } catch {
    return { bookingCount: 0, revenuePaise: 0, avgLeadMinutes: 0, noShowCount: 0 };
  }
}

function leadStats(input = {}) {
  const rows = ["appointments", "bookings", "onlineBookings"].map((tableName) => leadStatsFromTable(tableName, input));
  return rows.reduce((total, row) => ({
    bookingCount: total.bookingCount + row.bookingCount,
    revenuePaise: total.revenuePaise + row.revenuePaise,
    avgLeadMinutes: total.avgLeadMinutes || row.avgLeadMinutes,
    noShowCount: total.noShowCount + row.noShowCount
  }), { bookingCount: 0, revenuePaise: 0, avgLeadMinutes: 0, noShowCount: 0 });
}

function leadProfile(bucket) {
  if (bucket === "urgent_2h") {
    return { points: 14, cap: 32, pressure: "last_minute_fill", risk: "urgent_empty_slot", angle: "last_minute_slot_fill", reason: "Slot 2 hours ke andar hai; empty slot bachane ke liye stronger offer useful hai." };
  }
  if (bucket === "same_day") {
    return { points: 10, cap: 28, pressure: "same_day_fill", risk: "same_day_gap", angle: "same_day_booking_push", reason: "Same-day booking window me controlled discount slot fill kar sakta hai." };
  }
  if (bucket === "next_day") {
    return { points: 6, cap: 22, pressure: "near_term_fill", risk: "tomorrow_gap", angle: "tomorrow_slot_nudge", reason: "Next-day slot ke liye moderate nudge enough hai." };
  }
  if (bucket === "short_notice") {
    return { points: 3, cap: 16, pressure: "short_notice", risk: "normal", angle: "short_notice_offer", reason: "2-3 day lead time normal demand window hai; small nudge rakho." };
  }
  if (bucket === "standard_week") {
    return { points: 0, cap: 12, pressure: "normal_window", risk: "normal", angle: "standard_booking", reason: "Standard booking window me discount conservative rakho." };
  }
  return { points: -4, cap: 8, pressure: "advance_booking", risk: "low_urgency", angle: "advance_booking_protect_margin", reason: "Advance booking low urgency hoti hai; margin protect karo." };
}

function buildSuggestion(input = {}, mode = "recommended") {
  const current = normalizeScope(input);
  const currentSlot = slot(input);
  const serviceCategory = cleanCategory(input.serviceCategory);
  const leadMinutes = bookingLeadMinutes(input, currentSlot);
  const leadTimeBucket = leadBucket(leadMinutes);
  const range = bucketRange(leadTimeBucket);
  const lookbackDays = Math.max(7, Math.min(365, Number.parseInt(input.lookbackDays, 10) || 90));
  const profile = leadProfile(leadTimeBucket);
  const statsInput = {
    ...current,
    ...range,
    serviceCategory,
    fromDate: daysAgo(currentSlot.signalDate, lookbackDays)
  };
  const stats = leadStats(statsInput);
  const demand = demandContext({ ...current, ...currentSlot });
  const servicePricePaise = intPaise(input.servicePricePaise);
  const baseDiscountPercent = percent(input.baseDiscountPercent, 5);
  const reasons = [profile.reason];
  let points = profile.points;
  let cap = profile.cap;
  let slotFillPressure = profile.pressure;
  let urgencyRisk = profile.risk;

  if (demand.sampleCount && demand.occupancyRate < 0.35) {
    points += 7;
    cap = Math.min(35, cap + 5);
    slotFillPressure = "open_slot";
    reasons.push("DemandSignals occupancy low hai; slot fill discount boost allowed hai.");
  } else if (demand.occupancyRate >= 0.8) {
    points -= 9;
    cap = Math.min(cap, 6);
    urgencyRisk = "high_demand_protect_margin";
    reasons.push("Occupancy high hai; last-minute bhi extra discount avoid karo.");
  } else {
    reasons.push(demand.sampleCount ? "Slot occupancy stable range me hai." : "DemandSignals abhi collecting state me hai.");
  }

  const noShowRatePercent = stats.bookingCount ? percent((stats.noShowCount / stats.bookingCount) * 100) : 0;
  if (noShowRatePercent >= 25) {
    points -= 3;
    urgencyRisk = "no_show_risk";
    reasons.push("Is lead-time bucket me no-show/cancel risk high hai; discount conservative rakho.");
  }
  if (!stats.bookingCount) reasons.push("Lead-time history missing hai; suggestion review-only rakho.");
  if (mode === "conservative") points -= 4;
  if (mode === "aggressive") points += 5;

  const suggestedDiscountPercent = Math.round(Math.max(0, Math.min(cap, baseDiscountPercent + points)));
  const expectedDiscountPaise = Math.round(servicePricePaise * (suggestedDiscountPercent / 100));

  return {
    ...current,
    ...currentSlot,
    leadTimeBucket,
    serviceCategory,
    bookingLeadMinutes: leadMinutes,
    servicePricePaise,
    baseDiscountPercent,
    occupancyRate: demand.occupancyRate,
    sampleCount: demand.sampleCount,
    historicalBookingCount: stats.bookingCount,
    historicalRevenuePaise: stats.revenuePaise,
    avgHistoricalLeadMinutes: stats.avgLeadMinutes,
    noShowRatePercent,
    slotFillPressure,
    urgencyRisk,
    campaignAngle: profile.angle,
    suggestedDiscountPercent,
    expectedDiscountPaise,
    expectedRevenuePaise: Math.max(0, servicePricePaise - expectedDiscountPaise),
    status: stats.bookingCount || demand.sampleCount ? "ready" : "collecting",
    mode,
    reasons
  };
}

export function evaluate(scope = {}) {
  const best = buildSuggestion(scope, "recommended");
  const rows = [
    buildSuggestion(scope, "conservative"),
    best,
    buildSuggestion(scope, "aggressive")
  ];
  return {
    status: best.status,
    best,
    rows,
    summary: {
      leadTimeBucket: best.leadTimeBucket,
      bookingLeadMinutes: best.bookingLeadMinutes,
      slotFillPressure: best.slotFillPressure,
      historicalBookingCount: best.historicalBookingCount,
      noShowRatePercent: best.noShowRatePercent,
      maxDiscountPercent: Math.max(...rows.map((row) => Number(row.suggestedDiscountPercent || 0))),
      expectedRevenuePaise: best.expectedRevenuePaise
    }
  };
}

export function saveSuggestion(scope = {}) {
  const row = evaluate(scope).best;
  const payload = {
    ...row,
    reasons: JSON.stringify(row.reasons || []),
    status: "suggested"
  };
  const result = db.prepare(`
    INSERT INTO happyHoursLeadTimeSuggestions (
      tenantId, branchId, leadTimeBucket, serviceCategory, signalDate,
      dayOfWeek, hourSlot, requestedStartAt, bookingLeadMinutes,
      servicePricePaise, baseDiscountPercent, occupancyRate, sampleCount,
      historicalBookingCount, historicalRevenuePaise, avgHistoricalLeadMinutes,
      noShowRatePercent, slotFillPressure, urgencyRisk, campaignAngle,
      suggestedDiscountPercent, expectedDiscountPaise, expectedRevenuePaise,
      status, reasons
    )
    VALUES (
      @tenantId, @branchId, @leadTimeBucket, @serviceCategory, @signalDate,
      @dayOfWeek, @hourSlot, @requestedStartAt, @bookingLeadMinutes,
      @servicePricePaise, @baseDiscountPercent, @occupancyRate, @sampleCount,
      @historicalBookingCount, @historicalRevenuePaise, @avgHistoricalLeadMinutes,
      @noShowRatePercent, @slotFillPressure, @urgencyRisk, @campaignAngle,
      @suggestedDiscountPercent, @expectedDiscountPaise, @expectedRevenuePaise,
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
      FROM happyHoursLeadTimeSuggestions
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
    UPDATE happyHoursLeadTimeSuggestions
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
    FROM happyHoursLeadTimeSuggestions
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

export const happyHoursLeadTimeRepo = {
  evaluate,
  saveSuggestion,
  listSuggestions,
  updateStatus
};
