import { db } from "../db.js";
import { discountRulesRepo } from "./discount-rules.repo.js";
import { whiteLabelRulesRepo } from "./white-label-rules.repo.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS promotionCalendar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    title TEXT NOT NULL,
    promoType TEXT NOT NULL DEFAULT 'slow_hour',
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    startTime TEXT DEFAULT '',
    endTime TEXT DEFAULT '',
    ruleId INTEGER DEFAULT NULL,
    couponId INTEGER DEFAULT NULL,
    audienceJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT NOT NULL DEFAULT '',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_promotionCalendar_scope
    ON promotionCalendar(tenantId, branchId, status, startDate, endDate);

  CREATE TABLE IF NOT EXISTS discountCoupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    discountType TEXT NOT NULL DEFAULT 'percent',
    discountValue INTEGER NOT NULL DEFAULT 0,
    maxDiscountPaise INTEGER NOT NULL DEFAULT 0,
    usageLimit INTEGER NOT NULL DEFAULT 0,
    perClientLimit INTEGER NOT NULL DEFAULT 1,
    usedCount INTEGER NOT NULL DEFAULT 0,
    validFrom TEXT DEFAULT NULL,
    validTo TEXT DEFAULT NULL,
    targetJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, code)
  );

  CREATE INDEX IF NOT EXISTS idx_discountCoupons_scope
    ON discountCoupons(tenantId, branchId, status, validFrom, validTo);

  CREATE TABLE IF NOT EXISTS discountCouponUsage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    couponId INTEGER NOT NULL,
    couponCode TEXT NOT NULL,
    clientId TEXT DEFAULT '',
    invoiceId TEXT DEFAULT '',
    amountPaise INTEGER NOT NULL DEFAULT 0,
    discountPaise INTEGER NOT NULL DEFAULT 0,
    usedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_discountCouponUsage_scope
    ON discountCouponUsage(tenantId, branchId, couponId, usedAt);

  CREATE INDEX IF NOT EXISTS idx_discountCouponUsage_client
    ON discountCouponUsage(tenantId, branchId, couponId, clientId);

  CREATE TABLE IF NOT EXISTS offerRoiEvents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    ruleId INTEGER DEFAULT NULL,
    couponId INTEGER DEFAULT NULL,
    clientId TEXT DEFAULT '',
    invoiceId TEXT DEFAULT '',
    amountPaise INTEGER NOT NULL DEFAULT 0,
    discountPaise INTEGER NOT NULL DEFAULT 0,
    grossMarginPaise INTEGER NOT NULL DEFAULT 0,
    repeatClient INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_offerRoiEvents_scope
    ON offerRoiEvents(tenantId, branchId, createdAt);

  CREATE INDEX IF NOT EXISTS idx_offerRoiEvents_rule
    ON offerRoiEvents(tenantId, branchId, ruleId, couponId);

  CREATE TABLE IF NOT EXISTS clientSegments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    segmentKey TEXT NOT NULL,
    definitionJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, segmentKey)
  );

  CREATE INDEX IF NOT EXISTS idx_clientSegments_scope
    ON clientSegments(tenantId, branchId, status);

  CREATE TABLE IF NOT EXISTS staffDiscountIncentives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    staffId TEXT NOT NULL,
    ruleId INTEGER DEFAULT NULL,
    couponId INTEGER DEFAULT NULL,
    bookingId TEXT DEFAULT '',
    invoiceId TEXT DEFAULT '',
    saleAmountPaise INTEGER NOT NULL DEFAULT 0,
    discountPaise INTEGER NOT NULL DEFAULT 0,
    incentivePaise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT 'manual',
    notes TEXT NOT NULL DEFAULT '',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_staffDiscountIncentives_scope
    ON staffDiscountIncentives(tenantId, branchId, staffId, status);

  CREATE TABLE IF NOT EXISTS discountWhatsappDrafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    ruleId INTEGER DEFAULT NULL,
    couponId INTEGER DEFAULT NULL,
    segmentId INTEGER DEFAULT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    targetJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    scheduledFor TEXT DEFAULT NULL,
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_discountWhatsappDrafts_scope
    ON discountWhatsappDrafts(tenantId, branchId, status, createdAt);

  CREATE TABLE IF NOT EXISTS discountAbuseAlerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    signature TEXT NOT NULL,
    alertType TEXT NOT NULL,
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

  CREATE INDEX IF NOT EXISTS idx_discountAbuseAlerts_scope
    ON discountAbuseAlerts(tenantId, branchId, status, severity);

  CREATE TABLE IF NOT EXISTS offerTemplates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    templateKey TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    conditionsJson TEXT NOT NULL DEFAULT '[]',
    actionJson TEXT NOT NULL DEFAULT '{}',
    calendarDefaultsJson TEXT NOT NULL DEFAULT '{}',
    segmentDefaultsJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, templateKey)
  );

  CREATE INDEX IF NOT EXISTS idx_offerTemplates_scope
    ON offerTemplates(tenantId, branchId, status);
`);

const STATUSES = new Set(["draft", "scheduled", "active", "paused", "expired", "archived"]);
const COUPON_TYPES = new Set(["percent", "flat"]);
const ALERT_STATUSES = new Set(["open", "reviewed", "dismissed"]);
const ALERT_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const INCENTIVE_STATUSES = new Set(["pending", "approved", "paid", "paused", "rejected"]);

const defaultTemplates = [
  {
    templateKey: "weekday_slow_hour",
    name: "Weekday Slow Hour",
    description: "Low occupancy weekday booster for quiet slots.",
    conditions: [
      { field: "dayOfWeek", operator: "in", value: [1, 2, 3, 4] },
      { field: "occupancyRate", operator: "lte", value: 45 }
    ],
    action: { type: "percent", value: 15, maxDiscountPaise: 50000, applyTo: "cart", targetIds: [] },
    calendarDefaults: { promoType: "slow_hour", startTime: "12:00", endTime: "16:00" },
    segmentDefaults: { segmentKey: "weekday_slow_hour", criteria: { dayOfWeek: [1, 2, 3, 4], occupancyRateLte: 45 } }
  },
  {
    templateKey: "first_visit",
    name: "First Visit",
    description: "New client welcome offer with a safe cap.",
    conditions: [{ field: "clientSegment", operator: "eq", value: "new" }],
    action: { type: "percent", value: 10, maxDiscountPaise: 30000, applyTo: "cart", targetIds: [] },
    calendarDefaults: { promoType: "first_visit" },
    segmentDefaults: { segmentKey: "new_clients", criteria: { visitCountLte: 0 } }
  },
  {
    templateKey: "group_booking",
    name: "Group Booking",
    description: "Family or group appointment incentive.",
    conditions: [{ field: "groupSize", operator: "gte", value: 3 }],
    action: { type: "percent", value: 12, maxDiscountPaise: 75000, applyTo: "cart", targetIds: [] },
    calendarDefaults: { promoType: "group_booking" },
    segmentDefaults: { segmentKey: "groups", criteria: { groupSizeGte: 3 } }
  },
  {
    templateKey: "rainy_day",
    name: "Rainy Day Offer",
    description: "Weather-sensitive footfall recovery offer.",
    conditions: [{ field: "weatherCondition", operator: "eq", value: "rain" }],
    action: { type: "percent", value: 10, maxDiscountPaise: 40000, applyTo: "cart", targetIds: [] },
    calendarDefaults: { promoType: "weather", startTime: "11:00", endTime: "18:00" },
    segmentDefaults: { segmentKey: "rainy_day", criteria: { weatherCondition: "rain" } }
  },
  {
    templateKey: "low_occupancy_boost",
    name: "Low Occupancy Boost",
    description: "Controlled offer for under-utilized staff hours.",
    conditions: [
      { field: "occupancyRate", operator: "lte", value: 35 },
      { field: "timeRange", operator: "between", value: ["14:00", "17:00"] }
    ],
    action: { type: "percent", value: 20, maxDiscountPaise: 60000, applyTo: "cart", targetIds: [] },
    calendarDefaults: { promoType: "low_occupancy", startTime: "14:00", endTime: "17:00" },
    segmentDefaults: { segmentKey: "low_occupancy", criteria: { occupancyRateLte: 35 } }
  }
];

const statements = {
  calendarInsert: db.prepare(`
    INSERT INTO promotionCalendar (
      tenantId, branchId, title, promoType, startDate, endDate, startTime,
      endTime, ruleId, couponId, audienceJson, status, notes, createdBy
    )
    VALUES (
      @tenantId, @branchId, @title, @promoType, @startDate, @endDate, @startTime,
      @endTime, @ruleId, @couponId, @audienceJson, @status, @notes, @createdBy
    )
  `),
  calendarUpdate: db.prepare(`
    UPDATE promotionCalendar
    SET title = @title,
        promoType = @promoType,
        startDate = @startDate,
        endDate = @endDate,
        startTime = @startTime,
        endTime = @endTime,
        ruleId = @ruleId,
        couponId = @couponId,
        audienceJson = @audienceJson,
        status = @status,
        notes = @notes,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  calendarGet: db.prepare(`
    SELECT * FROM promotionCalendar
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
    LIMIT 1
  `),
  calendarDelete: db.prepare(`
    DELETE FROM promotionCalendar
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  couponInsert: db.prepare(`
    INSERT INTO discountCoupons (
      tenantId, branchId, code, title, discountType, discountValue, maxDiscountPaise,
      usageLimit, perClientLimit, validFrom, validTo, targetJson, status, createdBy
    )
    VALUES (
      @tenantId, @branchId, @code, @title, @discountType, @discountValue, @maxDiscountPaise,
      @usageLimit, @perClientLimit, @validFrom, @validTo, @targetJson, @status, @createdBy
    )
  `),
  couponUpdate: db.prepare(`
    UPDATE discountCoupons
    SET code = @code,
        title = @title,
        discountType = @discountType,
        discountValue = @discountValue,
        maxDiscountPaise = @maxDiscountPaise,
        usageLimit = @usageLimit,
        perClientLimit = @perClientLimit,
        validFrom = @validFrom,
        validTo = @validTo,
        targetJson = @targetJson,
        status = @status,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  couponGet: db.prepare(`
    SELECT * FROM discountCoupons
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
    LIMIT 1
  `),
  couponByCode: db.prepare(`
    SELECT * FROM discountCoupons
    WHERE tenantId = @tenantId AND branchId = @branchId AND code = @code
    LIMIT 1
  `),
  couponDelete: db.prepare(`
    DELETE FROM discountCoupons
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  couponUsageForClient: db.prepare(`
    SELECT COUNT(*) AS used
    FROM discountCouponUsage
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND couponId = @couponId
      AND clientId = @clientId
  `),
  couponUsageInsert: db.prepare(`
    INSERT INTO discountCouponUsage (
      tenantId, branchId, couponId, couponCode, clientId, invoiceId,
      amountPaise, discountPaise, metadata
    )
    VALUES (
      @tenantId, @branchId, @couponId, @couponCode, @clientId, @invoiceId,
      @amountPaise, @discountPaise, @metadata
    )
  `),
  couponIncrement: db.prepare(`
    UPDATE discountCoupons
    SET usedCount = usedCount + 1,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  roiInsert: db.prepare(`
    INSERT INTO offerRoiEvents (
      tenantId, branchId, ruleId, couponId, clientId, invoiceId, amountPaise,
      discountPaise, grossMarginPaise, repeatClient, source, metadata
    )
    VALUES (
      @tenantId, @branchId, @ruleId, @couponId, @clientId, @invoiceId, @amountPaise,
      @discountPaise, @grossMarginPaise, @repeatClient, @source, @metadata
    )
  `),
  segmentInsert: db.prepare(`
    INSERT INTO clientSegments (tenantId, branchId, name, segmentKey, definitionJson, status, createdBy)
    VALUES (@tenantId, @branchId, @name, @segmentKey, @definitionJson, @status, @createdBy)
    ON CONFLICT(tenantId, branchId, segmentKey)
    DO UPDATE SET
      name = excluded.name,
      definitionJson = excluded.definitionJson,
      status = excluded.status,
      updatedAt = strftime('%s','now')
  `),
  segmentUpdate: db.prepare(`
    UPDATE clientSegments
    SET name = @name,
        segmentKey = @segmentKey,
        definitionJson = @definitionJson,
        status = @status,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  segmentGet: db.prepare(`
    SELECT * FROM clientSegments
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
    LIMIT 1
  `),
  segmentDelete: db.prepare(`
    DELETE FROM clientSegments
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  incentiveInsert: db.prepare(`
    INSERT INTO staffDiscountIncentives (
      tenantId, branchId, staffId, ruleId, couponId, bookingId, invoiceId,
      saleAmountPaise, discountPaise, incentivePaise, status, source, notes, createdBy
    )
    VALUES (
      @tenantId, @branchId, @staffId, @ruleId, @couponId, @bookingId, @invoiceId,
      @saleAmountPaise, @discountPaise, @incentivePaise, @status, @source, @notes, @createdBy
    )
  `),
  incentiveUpdate: db.prepare(`
    UPDATE staffDiscountIncentives
    SET status = @status,
        incentivePaise = @incentivePaise,
        notes = @notes,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  incentiveGet: db.prepare(`
    SELECT * FROM staffDiscountIncentives
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
    LIMIT 1
  `),
  whatsappInsert: db.prepare(`
    INSERT INTO discountWhatsappDrafts (
      tenantId, branchId, ruleId, couponId, segmentId, title, message,
      targetJson, status, scheduledFor, createdBy
    )
    VALUES (
      @tenantId, @branchId, @ruleId, @couponId, @segmentId, @title, @message,
      @targetJson, @status, @scheduledFor, @createdBy
    )
  `),
  whatsappUpdate: db.prepare(`
    UPDATE discountWhatsappDrafts
    SET title = @title,
        message = @message,
        targetJson = @targetJson,
        status = @status,
        scheduledFor = @scheduledFor,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  whatsappGet: db.prepare(`
    SELECT * FROM discountWhatsappDrafts
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
    LIMIT 1
  `),
  abuseUpsert: db.prepare(`
    INSERT INTO discountAbuseAlerts (
      tenantId, branchId, signature, alertType, severity, status, title,
      description, evidenceJson, detectedAt
    )
    VALUES (
      @tenantId, @branchId, @signature, @alertType, @severity, @status, @title,
      @description, @evidenceJson, @detectedAt
    )
    ON CONFLICT(tenantId, branchId, signature)
    DO UPDATE SET
      alertType = excluded.alertType,
      severity = excluded.severity,
      title = excluded.title,
      description = excluded.description,
      evidenceJson = excluded.evidenceJson,
      detectedAt = excluded.detectedAt,
      status = CASE
        WHEN discountAbuseAlerts.status = 'reviewed' THEN discountAbuseAlerts.status
        ELSE excluded.status
      END,
      updatedAt = strftime('%s','now')
  `),
  abuseGetBySignature: db.prepare(`
    SELECT * FROM discountAbuseAlerts
    WHERE tenantId = @tenantId AND branchId = @branchId AND signature = @signature
    LIMIT 1
  `),
  abuseReview: db.prepare(`
    UPDATE discountAbuseAlerts
    SET status = @status,
        reviewedBy = @reviewedBy,
        reviewedAt = strftime('%s','now'),
        reviewNote = @reviewNote,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  abuseGet: db.prepare(`
    SELECT * FROM discountAbuseAlerts
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
    LIMIT 1
  `),
  templateInsert: db.prepare(`
    INSERT INTO offerTemplates (
      tenantId, branchId, templateKey, name, description, conditionsJson,
      actionJson, calendarDefaultsJson, segmentDefaultsJson, status, createdBy
    )
    VALUES (
      @tenantId, @branchId, @templateKey, @name, @description, @conditionsJson,
      @actionJson, @calendarDefaultsJson, @segmentDefaultsJson, @status, @createdBy
    )
    ON CONFLICT(tenantId, branchId, templateKey) DO NOTHING
  `),
  templateByKey: db.prepare(`
    SELECT * FROM offerTemplates
    WHERE tenantId = @tenantId AND branchId = @branchId AND templateKey = @templateKey
    LIMIT 1
  `)
};

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function intValue(value, fallback = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function shortText(value, fallback = "", maxLength = 160) {
  const text = String(value || fallback || "").trim();
  return text.slice(0, maxLength);
}

function status(value, fallback = "draft") {
  const text = String(value || fallback).trim();
  return STATUSES.has(text) ? text : fallback;
}

function alertStatus(value, fallback = "open") {
  const text = String(value || fallback).trim();
  return ALERT_STATUSES.has(text) ? text : fallback;
}

function incentiveStatus(value, fallback = "pending") {
  const text = String(value || fallback).trim();
  return INCENTIVE_STATUSES.has(text) ? text : fallback;
}

function severity(value, fallback = "medium") {
  const text = String(value || fallback).trim();
  return ALERT_SEVERITIES.has(text) ? text : fallback;
}

function todayIst() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 330 * 60000).toISOString().slice(0, 10);
}

function epochStart(value) {
  if (!value) return 0;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+05:30`);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : 0;
}

function epochEnd(value) {
  if (!value) return Math.floor(Date.now() / 1000);
  const date = new Date(`${String(value).slice(0, 10)}T23:59:59+05:30`);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : Math.floor(Date.now() / 1000);
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
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

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function normalizeDate(value, fallback = todayIst()) {
  const text = String(value || fallback).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function idFrom(value) {
  return Number.parseInt(value, 10) || null;
}

function parseCalendar(row) {
  if (!row) return null;
  return {
    ...row,
    audience: parseJson(row.audienceJson, {})
  };
}

function parseCoupon(row) {
  if (!row) return null;
  return {
    ...row,
    target: parseJson(row.targetJson, {})
  };
}

function parseSegment(row) {
  if (!row) return null;
  return {
    ...row,
    definition: parseJson(row.definitionJson, {})
  };
}

function parseWhatsapp(row) {
  if (!row) return null;
  return {
    ...row,
    target: parseJson(row.targetJson, {})
  };
}

function parseAlert(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: parseJson(row.evidenceJson, {})
  };
}

function parseTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    conditions: parseJson(row.conditionsJson, []),
    action: parseJson(row.actionJson, {}),
    calendarDefaults: parseJson(row.calendarDefaultsJson, {}),
    segmentDefaults: parseJson(row.segmentDefaultsJson, {})
  };
}

function normalizeCalendar(data = {}) {
  const startDate = normalizeDate(data.startDate);
  const endDate = normalizeDate(data.endDate || startDate, startDate);
  return {
    ...requireScope(data),
    id: idFrom(data.id),
    title: shortText(data.title, "Promotion"),
    promoType: shortText(data.promoType, "slow_hour", 60),
    startDate,
    endDate: endDate < startDate ? startDate : endDate,
    startTime: shortText(data.startTime, "", 8),
    endTime: shortText(data.endTime, "", 8),
    ruleId: idFrom(data.ruleId),
    couponId: idFrom(data.couponId),
    audienceJson: jsonText(data.audience ?? data.audienceJson, {}),
    status: status(data.status, "draft"),
    notes: shortText(data.notes, "", 500),
    createdBy: data.createdBy || null
  };
}

function normalizeCoupon(data = {}) {
  const code = shortText(data.code, "", 32).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!code) throw new Error("coupon code is required");
  const discountType = COUPON_TYPES.has(data.discountType) ? data.discountType : "percent";
  return {
    ...requireScope(data),
    id: idFrom(data.id),
    code,
    title: shortText(data.title, code),
    discountType,
    discountValue: Math.max(0, intValue(data.discountValue ?? data.value, 0)),
    maxDiscountPaise: intPaise(data.maxDiscountPaise),
    usageLimit: Math.max(0, intValue(data.usageLimit, 0)),
    perClientLimit: Math.max(1, intValue(data.perClientLimit, 1)),
    validFrom: data.validFrom ? normalizeDate(data.validFrom) : null,
    validTo: data.validTo ? normalizeDate(data.validTo) : null,
    targetJson: jsonText(data.target ?? data.targetJson, {}),
    status: status(data.status, "draft"),
    createdBy: data.createdBy || null
  };
}

function normalizeSegment(data = {}) {
  const name = shortText(data.name, "Client segment");
  const segmentKey = shortText(data.segmentKey || name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), "", 80);
  if (!segmentKey) throw new Error("segmentKey is required");
  return {
    ...requireScope(data),
    id: idFrom(data.id),
    name,
    segmentKey,
    definitionJson: jsonText(data.definition ?? data.definitionJson, {}),
    status: status(data.status, "active"),
    createdBy: data.createdBy || null
  };
}

function normalizeIncentive(data = {}) {
  const staffId = shortText(data.staffId, "", 80);
  if (!staffId) throw new Error("staffId is required");
  const saleAmountPaise = intPaise(data.saleAmountPaise ?? data.amountPaise);
  const incentivePaise = data.incentivePaise === undefined
    ? Math.round(intPaise(data.discountPaise) * 0.1)
    : intPaise(data.incentivePaise);
  return {
    ...requireScope(data),
    id: idFrom(data.id),
    staffId,
    ruleId: idFrom(data.ruleId),
    couponId: idFrom(data.couponId),
    bookingId: shortText(data.bookingId, "", 80),
    invoiceId: shortText(data.invoiceId, "", 80),
    saleAmountPaise,
    discountPaise: intPaise(data.discountPaise),
    incentivePaise,
    status: incentiveStatus(data.status),
    source: shortText(data.source, "manual", 80),
    notes: shortText(data.notes, "", 500),
    createdBy: data.createdBy || null
  };
}

function normalizeWhatsapp(data = {}) {
  const title = shortText(data.title, "Happy Hours WhatsApp draft");
  const message = String(data.message || "").trim();
  if (!message) throw new Error("message is required");
  return {
    ...requireScope(data),
    id: idFrom(data.id),
    ruleId: idFrom(data.ruleId),
    couponId: idFrom(data.couponId),
    segmentId: idFrom(data.segmentId),
    title,
    message: message.slice(0, 1200),
    targetJson: jsonText(data.target ?? data.targetJson, {}),
    status: status(data.status, "draft"),
    scheduledFor: data.scheduledFor || null,
    createdBy: data.createdBy || null
  };
}

function activeDateFilter(row, currentDate = todayIst()) {
  return (!row.validFrom || row.validFrom <= currentDate) && (!row.validTo || row.validTo >= currentDate);
}

function calendarListSql({ statusFilter }) {
  return `
    SELECT * FROM promotionCalendar
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND startDate <= @toDate
      AND endDate >= @fromDate
      ${statusFilter ? "AND status = @status" : ""}
    ORDER BY startDate ASC, startTime ASC, id ASC
    LIMIT @limit OFFSET @offset
  `;
}

function couponListSql({ statusFilter }) {
  return `
    SELECT * FROM discountCoupons
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      ${statusFilter ? "AND status = @status" : ""}
    ORDER BY updatedAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `;
}

function simpleList(tableName, parser, scope = {}, extraWhere = "") {
  const current = requireScope(scope);
  const limit = Math.min(500, Math.max(1, intValue(scope.limit, 100)));
  const offset = Math.max(0, intValue(scope.offset, 0));
  const rows = db.prepare(`
    SELECT * FROM ${tableName}
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      ${extraWhere}
    ORDER BY updatedAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...current, status: scope.status || null, limit, offset }).map(parser);
  return { rows, limit, offset };
}

function countWhere(tableName, where, params) {
  if (!tableExists(tableName)) return 0;
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where}`).get(params)?.count || 0);
}

function sumWhere(tableName, column, where, params) {
  if (!tableExists(tableName)) return 0;
  return intPaise(db.prepare(`SELECT SUM(${column}) AS total FROM ${tableName} WHERE ${where}`).get(params)?.total);
}

function auditRows(scope = {}) {
  if (!tableExists("discountAuditLog")) return [];
  const current = requireScope(scope);
  return db.prepare(`
    SELECT *
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
    ORDER BY createdAt DESC, id DESC
    LIMIT 10000
  `).all({
    ...current,
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to)
  }).map((row) => ({
    ...row,
    amountPaise: intPaise(row.amountPaise),
    discountPaise: intPaise(row.discountPaise),
    gstImpactPaise: intPaise(row.gstImpactPaise),
    metadata: parseJson(row.metadata, {})
  }));
}

function roiEventRows(scope = {}) {
  const current = requireScope(scope);
  return db.prepare(`
    SELECT *
    FROM offerRoiEvents
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
    ORDER BY createdAt DESC, id DESC
    LIMIT 10000
  `).all({
    ...current,
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to)
  }).map((row) => ({
    ...row,
    amountPaise: intPaise(row.amountPaise),
    discountPaise: intPaise(row.discountPaise),
    grossMarginPaise: intPaise(row.grossMarginPaise),
    repeatClient: Boolean(row.repeatClient),
    metadata: parseJson(row.metadata, {})
  }));
}

function ruleNameMap(scope = {}) {
  const current = requireScope(scope);
  if (!tableExists("discountRules")) return new Map();
  return new Map(db.prepare(`
    SELECT id, name
    FROM discountRules
    WHERE tenantId = @tenantId AND branchId = @branchId
  `).all(current).map((row) => [String(row.id), row.name]));
}

function couponNameMap(scope = {}) {
  const current = requireScope(scope);
  return new Map(db.prepare(`
    SELECT id, code, title
    FROM discountCoupons
    WHERE tenantId = @tenantId AND branchId = @branchId
  `).all(current).map((row) => [String(row.id), `${row.code} - ${row.title}`]));
}

function summarizeRoiRows(rows, names, coupons) {
  const byOffer = new Map();
  for (const row of rows) {
    const key = row.couponId ? `coupon:${row.couponId}` : `rule:${row.ruleId || "unattributed"}`;
    const current = byOffer.get(key) || {
      offerKey: key,
      ruleId: row.ruleId || null,
      couponId: row.couponId || null,
      offerName: row.couponId ? coupons.get(String(row.couponId)) || `Coupon ${row.couponId}` : names.get(String(row.ruleId)) || "Unattributed discount",
      applications: 0,
      clients: new Set(),
      repeatClients: 0,
      grossRevenuePaise: 0,
      netRevenuePaise: 0,
      totalDiscountPaise: 0,
      grossMarginPaise: 0
    };
    current.applications += 1;
    if (row.clientId) current.clients.add(row.clientId);
    if (row.repeatClient || row.metadata?.repeatClient) current.repeatClients += 1;
    current.grossRevenuePaise += intPaise(row.amountPaise);
    current.totalDiscountPaise += intPaise(row.discountPaise);
    current.netRevenuePaise += Math.max(0, intPaise(row.amountPaise) - intPaise(row.discountPaise));
    current.grossMarginPaise += intPaise(row.grossMarginPaise || row.metadata?.grossMarginPaise);
    byOffer.set(key, current);
  }
  return [...byOffer.values()].map((row) => ({
    ...row,
    uniqueClients: row.clients.size,
    clients: undefined,
    discountRatePercent: row.grossRevenuePaise ? Math.round((row.totalDiscountPaise * 10000) / row.grossRevenuePaise) / 100 : 0,
    returnOnDiscountPercent: row.totalDiscountPaise ? Math.round((row.netRevenuePaise * 10000) / row.totalDiscountPaise) / 100 : 0
  })).sort((left, right) => right.netRevenuePaise - left.netRevenuePaise);
}

function branchPerformance(scope = {}) {
  if (!tableExists("discountAuditLog")) return [];
  const current = requireScope(scope);
  const rows = db.prepare(`
    SELECT branchId,
           COUNT(*) AS events,
           SUM(CASE WHEN eventType = 'discount_applied' THEN amountPaise ELSE 0 END) AS grossRevenuePaise,
           SUM(CASE WHEN eventType = 'discount_applied' THEN discountPaise ELSE 0 END) AS totalDiscountPaise,
           SUM(CASE WHEN eventType = 'budget_exceeded' THEN 1 ELSE 0 END) AS budgetExceededCount,
           SUM(CASE WHEN eventType = 'margin_blocked' THEN 1 ELSE 0 END) AS marginBlockedCount
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
    GROUP BY branchId
    ORDER BY grossRevenuePaise DESC
    LIMIT 20
  `).all({
    ...current,
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to)
  });
  return rows.map((row) => {
    const grossRevenuePaise = intPaise(row.grossRevenuePaise);
    const totalDiscountPaise = intPaise(row.totalDiscountPaise);
    return {
      branchId: row.branchId,
      events: Number(row.events || 0),
      grossRevenuePaise,
      netRevenuePaise: Math.max(0, grossRevenuePaise - totalDiscountPaise),
      totalDiscountPaise,
      budgetExceededCount: Number(row.budgetExceededCount || 0),
      marginBlockedCount: Number(row.marginBlockedCount || 0),
      discountRatePercent: grossRevenuePaise ? Math.round((totalDiscountPaise * 10000) / grossRevenuePaise) / 100 : 0
    };
  });
}

function ensureDefaultTemplates(scope = {}) {
  const current = requireScope(scope);
  for (const template of defaultTemplates) {
    statements.templateInsert.run({
      ...current,
      templateKey: template.templateKey,
      name: template.name,
      description: template.description,
      conditionsJson: jsonText(template.conditions, []),
      actionJson: jsonText(template.action, {}),
      calendarDefaultsJson: jsonText(template.calendarDefaults, {}),
      segmentDefaultsJson: jsonText(template.segmentDefaults, {}),
      status: "active",
      createdBy: "system"
    });
  }
}

function activeCoupons(scope = {}) {
  const currentDate = scope.currentDate || todayIst();
  return db.prepare(`
    SELECT *
    FROM discountCoupons
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
      AND (validFrom IS NULL OR validFrom <= @currentDate)
      AND (validTo IS NULL OR validTo >= @currentDate)
    ORDER BY updatedAt DESC, id DESC
    LIMIT 50
  `).all({ ...requireScope(scope), currentDate }).map(parseCoupon);
}

function activeCalendar(scope = {}) {
  const currentDate = scope.currentDate || todayIst();
  return db.prepare(`
    SELECT *
    FROM promotionCalendar
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status IN ('scheduled', 'active')
      AND startDate <= @currentDate
      AND endDate >= @currentDate
    ORDER BY startTime ASC, id ASC
    LIMIT 50
  `).all({ ...requireScope(scope), currentDate }).map(parseCalendar);
}

function listValues(...values) {
  const rows = [];
  for (const value of values) {
    if (Array.isArray(value)) rows.push(...value);
    else if (value !== undefined && value !== null && value !== "") rows.push(...String(value).split(","));
  }
  return rows.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

function matchesList(values, actual) {
  if (!values.length) return true;
  if (values.some((value) => ["all", "any", "all_clients", "everyone", "public"].includes(value))) return true;
  const text = String(actual || "").trim().toLowerCase();
  return Boolean(text) && values.includes(text);
}

function publicContext(scope = {}) {
  return {
    ...requireScope(scope),
    currentDate: scope.currentDate ? normalizeDate(scope.currentDate, todayIst()) : todayIst(),
    serviceId: shortText(scope.serviceId, "", 80),
    serviceCategory: shortText(scope.serviceCategory, "", 120),
    staffId: shortText(scope.staffId, "", 80),
    clientSegment: shortText(scope.clientSegment, "", 120),
    cartTotalPaise: intPaise(scope.cartTotalPaise ?? scope.servicePricePaise ?? scope.amountPaise)
  };
}

function matchesAudienceTarget(target = {}, context = {}) {
  if (target.publicVisible === false || target.bookingPortalVisible === false) return false;
  const targetApplyTo = String(target.applyTo || "").toLowerCase();
  const serviceIds = listValues(
    target.serviceId,
    target.serviceIds,
    target.services,
    targetApplyTo === "service" ? target.targetIds : []
  );
  if (!matchesList(serviceIds, context.serviceId)) return false;

  const serviceCategories = listValues(
    target.serviceCategory,
    target.serviceCategories,
    target.category,
    target.categories,
    targetApplyTo === "category" ? target.targetIds : []
  );
  if (!matchesList(serviceCategories, context.serviceCategory)) return false;

  const staffIds = listValues(target.staffId, target.staffIds);
  if (!matchesList(staffIds, context.staffId)) return false;

  const segments = listValues(target.clientSegment, target.clientSegments, target.segment, target.segments);
  if (!matchesList(segments, context.clientSegment)) return false;

  const minCartPaise = intPaise(target.minCartPaise ?? target.minimumCartPaise ?? target.minAmountPaise);
  if (minCartPaise > 0 && context.cartTotalPaise > 0 && context.cartTotalPaise < minCartPaise) return false;
  return true;
}

function dayTokens(dateText) {
  const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const date = new Date(`${dateText}T00:00:00Z`);
  const index = Number.isNaN(date.getTime()) ? new Date().getUTCDay() : date.getUTCDay();
  return [names[index], String(index), String(index === 0 ? 7 : index)];
}

function conditionValue(field, context = {}) {
  if (field === "dayOfWeek") return dayTokens(context.currentDate);
  if (field === "dateRange") return context.currentDate;
  if (field === "cartTotalPaise") return context.cartTotalPaise;
  if (field === "serviceCategory") return context.serviceCategory;
  if (field === "staffId") return context.staffId;
  if (field === "clientSegment") return context.clientSegment;
  if (field === "serviceId") return context.serviceId;
  return undefined;
}

function matchesCondition(condition = {}, context = {}) {
  const field = String(condition.field || "");
  const actual = conditionValue(field, context);
  if (actual === undefined || actual === "" || actual === 0) return true;
  const operator = String(condition.operator || "eq").toLowerCase();
  const expected = Array.isArray(condition.value) ? condition.value : String(condition.value ?? "").split(",");

  if (field === "dayOfWeek") {
    const allowed = listValues(expected);
    return operator === "neq" ? !actual.some((token) => allowed.includes(token)) : actual.some((token) => allowed.includes(token));
  }

  if (field === "cartTotalPaise") {
    const number = Number(actual || 0);
    const value = Number(condition.value || 0);
    if (operator === "gte") return number >= value;
    if (operator === "gt") return number > value;
    if (operator === "lte") return number <= value;
    if (operator === "lt") return number < value;
    if (operator === "between") {
      const [min, max] = Array.isArray(condition.value) ? condition.value : String(condition.value || "").split(",");
      return number >= Number(min || 0) && number <= Number(max || Number.MAX_SAFE_INTEGER);
    }
    return number === value;
  }

  if (field === "dateRange") {
    const [from, to] = Array.isArray(condition.value) ? condition.value : String(condition.value || "").split(",");
    return (!from || actual >= from) && (!to || actual <= to);
  }

  const values = listValues(expected);
  const matched = matchesList(values, actual);
  return operator === "neq" ? !matched : matched;
}

function matchesRuleTarget(rule = {}, context = {}) {
  const action = rule.actionJson || {};
  if (action.publicVisible === false || action.bookingPortalVisible === false) return false;
  if (!matchesAudienceTarget(action, context)) return false;
  const conditions = Array.isArray(rule.conditionsJson) ? rule.conditionsJson : [];
  return conditions.every((condition) => matchesCondition(condition, context));
}

function actionSummary(action = {}) {
  if (action.type === "flat") return `Rs ${Math.round(intPaise(action.value) / 100)} off`;
  if (action.type === "bundle_price") return `Bundle at Rs ${Math.round(intPaise(action.value) / 100)}`;
  return `${Number(action.value || 0)}% off`;
}

function publicRuleTitle(labels, rule) {
  if (!labels.hideInternalRuleNames && rule.name) return rule.name;
  return labels.labels?.ruleName || "Salon offer";
}

export function getSummary(scope = {}) {
  const current = requireScope(scope);
  const params = { ...current, today: todayIst() };
  const activeRules = countWhere("discountRules", "tenantId = @tenantId AND branchId = @branchId AND status = 'active'", params);
  const pendingApprovals = countWhere("ruleApprovals", "tenantId = @tenantId AND branchId = @branchId AND status = 'pending'", params);
  const openAnomalies = countWhere("discountAnomalies", "tenantId = @tenantId AND branchId = @branchId AND status = 'open'", params);
  const savedSimulations = countWhere("discountSimulations", "tenantId = @tenantId AND branchId = @branchId", params);
  const activeCouponsCount = activeCoupons(current).length;
  const upcomingPromotions = countWhere("promotionCalendar", "tenantId = @tenantId AND branchId = @branchId AND endDate >= @today AND status IN ('scheduled', 'active')", params);
  const openAbuseAlerts = countWhere("discountAbuseAlerts", "tenantId = @tenantId AND branchId = @branchId AND status = 'open'", params);
  const budgetPaise = sumWhere("discountBudgets", "budgetPaise", "tenantId = @tenantId AND branchId = @branchId AND status = 'active'", params);
  const budgetSpentPaise = sumWhere("discountBudgets", "spentPaise", "tenantId = @tenantId AND branchId = @branchId AND status = 'active'", params);
  const roi = getOfferRoi({ ...current, from: scope.from, to: scope.to });
  return {
    ...current,
    activeRules,
    pendingApprovals,
    openAnomalies,
    savedSimulations,
    activeCoupons: activeCouponsCount,
    upcomingPromotions,
    openAbuseAlerts,
    budgetPaise,
    budgetSpentPaise,
    budgetRemainingPaise: Math.max(0, budgetPaise - budgetSpentPaise),
    budgetUsedPercent: budgetPaise ? Math.round((budgetSpentPaise * 10000) / budgetPaise) / 100 : 0,
    roi: roi.summary,
    branchPerformance: branchPerformance({ ...current, from: scope.from, to: scope.to })
  };
}

export function listCalendar(scope = {}) {
  const current = requireScope(scope);
  const limit = Math.min(500, Math.max(1, intValue(scope.limit, 100)));
  const offset = Math.max(0, intValue(scope.offset, 0));
  const statusFilter = scope.status && STATUSES.has(scope.status) ? scope.status : "";
  const fromDate = normalizeDate(scope.from || todayIst(), "1970-01-01");
  const toDate = normalizeDate(scope.to || "2999-12-31", "2999-12-31");
  const rows = db.prepare(calendarListSql({ statusFilter })).all({
    ...current,
    fromDate,
    toDate,
    status: statusFilter,
    limit,
    offset
  }).map(parseCalendar);
  return { rows, limit, offset };
}

export function saveCalendar(data = {}) {
  const payload = normalizeCalendar(data);
  const result = statements.calendarInsert.run(payload);
  return statements.calendarGet.get({ ...payload, id: Number(result.lastInsertRowid) });
}

export function updateCalendar(data = {}) {
  const payload = normalizeCalendar(data);
  if (!payload.id) throw new Error("valid promotion id is required");
  statements.calendarUpdate.run(payload);
  return parseCalendar(statements.calendarGet.get(payload));
}

export function deleteCalendar(scope = {}) {
  const current = requireScope(scope);
  const id = idFrom(scope.id);
  if (!id) throw new Error("valid promotion id is required");
  return statements.calendarDelete.run({ ...current, id }).changes;
}

export function listCoupons(scope = {}) {
  const current = requireScope(scope);
  const limit = Math.min(500, Math.max(1, intValue(scope.limit, 100)));
  const offset = Math.max(0, intValue(scope.offset, 0));
  const statusFilter = scope.status && STATUSES.has(scope.status) ? scope.status : "";
  const rows = db.prepare(couponListSql({ statusFilter })).all({
    ...current,
    status: statusFilter,
    limit,
    offset
  }).map(parseCoupon);
  return { rows, limit, offset };
}

export function saveCoupon(data = {}) {
  const payload = normalizeCoupon(data);
  const result = statements.couponInsert.run(payload);
  return parseCoupon(statements.couponGet.get({ ...payload, id: Number(result.lastInsertRowid) }));
}

export function updateCoupon(data = {}) {
  const payload = normalizeCoupon(data);
  if (!payload.id) throw new Error("valid coupon id is required");
  statements.couponUpdate.run(payload);
  return parseCoupon(statements.couponGet.get(payload));
}

export function deleteCoupon(scope = {}) {
  const current = requireScope(scope);
  const id = idFrom(scope.id);
  if (!id) throw new Error("valid coupon id is required");
  return statements.couponDelete.run({ ...current, id }).changes;
}

export function validateCoupon(data = {}) {
  const current = requireScope(data);
  const code = shortText(data.code, "", 32).toUpperCase();
  const coupon = parseCoupon(statements.couponByCode.get({ ...current, code }));
  if (!coupon) return { valid: false, reason: "coupon_not_found", discountPaise: 0 };
  const currentDate = data.currentDate || todayIst();
  if (coupon.status !== "active") return { valid: false, reason: "coupon_not_active", coupon, discountPaise: 0 };
  if (!activeDateFilter(coupon, currentDate)) return { valid: false, reason: "coupon_outside_validity", coupon, discountPaise: 0 };
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) return { valid: false, reason: "coupon_usage_limit_reached", coupon, discountPaise: 0 };
  const clientId = shortText(data.clientId, "", 80);
  if (clientId && coupon.perClientLimit > 0) {
    const used = Number(statements.couponUsageForClient.get({ ...current, couponId: coupon.id, clientId })?.used || 0);
    if (used >= coupon.perClientLimit) return { valid: false, reason: "coupon_client_limit_reached", coupon, discountPaise: 0 };
  }
  const cartTotalPaise = intPaise(data.cartTotalPaise ?? data.amountPaise);
  const attemptedDiscountPaise = coupon.discountType === "flat"
    ? intPaise(coupon.discountValue)
    : Math.round((cartTotalPaise * coupon.discountValue) / 100);
  const cappedByMax = coupon.maxDiscountPaise > 0 ? Math.min(attemptedDiscountPaise, coupon.maxDiscountPaise) : attemptedDiscountPaise;
  const discountPaise = Math.min(cartTotalPaise, cappedByMax);
  return { valid: true, reason: "coupon_valid", coupon, discountPaise, payablePaise: Math.max(0, cartTotalPaise - discountPaise) };
}

export function recordCouponUse(data = {}) {
  const validation = validateCoupon(data);
  if (!validation.valid) return { ...validation, recorded: false };
  const coupon = validation.coupon;
  const payload = {
    ...requireScope(data),
    couponId: coupon.id,
    couponCode: coupon.code,
    clientId: shortText(data.clientId, "", 80),
    invoiceId: shortText(data.invoiceId, "", 80),
    amountPaise: intPaise(data.cartTotalPaise ?? data.amountPaise),
    discountPaise: intPaise(data.discountPaise ?? validation.discountPaise),
    metadata: jsonText(data.metadata, {})
  };
  statements.couponUsageInsert.run(payload);
  statements.couponIncrement.run({ ...payload, id: coupon.id });
  return { recorded: true, ...validateCoupon({ ...data, code: coupon.code }) };
}

export function getOfferRoi(scope = {}) {
  const current = requireScope(scope);
  const names = ruleNameMap(current);
  const coupons = couponNameMap(current);
  const fromAudit = auditRows(scope)
    .filter((row) => row.eventType === "discount_applied")
    .map((row) => ({
      ruleId: row.ruleId || row.metadata?.ruleId || null,
      couponId: row.metadata?.couponId || null,
      clientId: row.metadata?.clientId || "",
      amountPaise: row.amountPaise,
      discountPaise: row.discountPaise,
      grossMarginPaise: row.metadata?.grossMarginPaise || 0,
      repeatClient: Boolean(row.metadata?.repeatClient),
      metadata: row.metadata
    }));
  const manual = roiEventRows(scope);
  const rows = summarizeRoiRows([...fromAudit, ...manual], names, coupons);
  const summary = rows.reduce((acc, row) => {
    acc.applications += row.applications;
    acc.grossRevenuePaise += row.grossRevenuePaise;
    acc.netRevenuePaise += row.netRevenuePaise;
    acc.totalDiscountPaise += row.totalDiscountPaise;
    acc.grossMarginPaise += row.grossMarginPaise;
    acc.repeatClients += row.repeatClients;
    return acc;
  }, {
    applications: 0,
    grossRevenuePaise: 0,
    netRevenuePaise: 0,
    totalDiscountPaise: 0,
    grossMarginPaise: 0,
    repeatClients: 0
  });
  return {
    ...current,
    from: scope.from || null,
    to: scope.to || null,
    summary: {
      ...summary,
      discountRatePercent: summary.grossRevenuePaise ? Math.round((summary.totalDiscountPaise * 10000) / summary.grossRevenuePaise) / 100 : 0,
      returnOnDiscountPercent: summary.totalDiscountPaise ? Math.round((summary.netRevenuePaise * 10000) / summary.totalDiscountPaise) / 100 : 0
    },
    rows
  };
}

export function recordRoiOutcome(data = {}) {
  const payload = {
    ...requireScope(data),
    ruleId: idFrom(data.ruleId),
    couponId: idFrom(data.couponId),
    clientId: shortText(data.clientId, "", 80),
    invoiceId: shortText(data.invoiceId, "", 80),
    amountPaise: intPaise(data.amountPaise),
    discountPaise: intPaise(data.discountPaise),
    grossMarginPaise: intPaise(data.grossMarginPaise),
    repeatClient: data.repeatClient ? 1 : 0,
    source: shortText(data.source, "manual", 80),
    metadata: jsonText(data.metadata, {})
  };
  const result = statements.roiInsert.run(payload);
  return { id: Number(result.lastInsertRowid), ...payload, repeatClient: Boolean(payload.repeatClient) };
}

export function listSegments(scope = {}) {
  return simpleList("clientSegments", parseSegment, scope, scope.status ? "AND status = @status" : "");
}

export function saveSegment(data = {}) {
  const payload = normalizeSegment(data);
  statements.segmentInsert.run(payload);
  return db.prepare(`
    SELECT * FROM clientSegments
    WHERE tenantId = @tenantId AND branchId = @branchId AND segmentKey = @segmentKey
    LIMIT 1
  `).get(payload);
}

export function updateSegment(data = {}) {
  const payload = normalizeSegment(data);
  if (!payload.id) throw new Error("valid segment id is required");
  statements.segmentUpdate.run(payload);
  return parseSegment(statements.segmentGet.get(payload));
}

export function deleteSegment(scope = {}) {
  const current = requireScope(scope);
  const id = idFrom(scope.id);
  if (!id) throw new Error("valid segment id is required");
  return statements.segmentDelete.run({ ...current, id }).changes;
}

export function evaluateSegments(data = {}) {
  const segments = listSegments({ ...data, status: "active", limit: 500 }).rows;
  const context = data.context || data;
  const matches = segments.filter((segment) => {
    const criteria = segment.definition?.criteria || segment.definition || {};
    if (criteria.visitCountGte !== undefined && Number(context.visitCount || 0) < Number(criteria.visitCountGte)) return false;
    if (criteria.visitCountLte !== undefined && Number(context.visitCount || 0) > Number(criteria.visitCountLte)) return false;
    if (criteria.inactiveDaysGte !== undefined && Number(context.inactiveDays || 0) < Number(criteria.inactiveDaysGte)) return false;
    if (criteria.totalSpendPaiseGte !== undefined && intPaise(context.totalSpendPaise) < intPaise(criteria.totalSpendPaiseGte)) return false;
    if (criteria.clientType && String(context.clientType || "") !== String(criteria.clientType)) return false;
    if (criteria.serviceCategory && String(context.serviceCategory || "") !== String(criteria.serviceCategory)) return false;
    return true;
  });
  return { matches, context };
}

export function listStaffIncentives(scope = {}) {
  const current = requireScope(scope);
  const limit = Math.min(500, Math.max(1, intValue(scope.limit, 100)));
  const offset = Math.max(0, intValue(scope.offset, 0));
  const rows = db.prepare(`
    SELECT *
    FROM staffDiscountIncentives
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND (@status IS NULL OR status = @status)
      AND (@staffId IS NULL OR staffId = @staffId)
    ORDER BY createdAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all({
    ...current,
    status: scope.status || null,
    staffId: scope.staffId || null,
    limit,
    offset
  });
  return { rows, limit, offset };
}

export function saveStaffIncentive(data = {}) {
  const payload = normalizeIncentive(data);
  const result = statements.incentiveInsert.run(payload);
  return statements.incentiveGet.get({ ...payload, id: Number(result.lastInsertRowid) });
}

export function updateStaffIncentive(data = {}) {
  const payload = normalizeIncentive(data);
  if (!payload.id) throw new Error("valid incentive id is required");
  statements.incentiveUpdate.run(payload);
  return statements.incentiveGet.get(payload);
}

export function listWhatsappDrafts(scope = {}) {
  return simpleList("discountWhatsappDrafts", parseWhatsapp, scope, scope.status ? "AND status = @status" : "");
}

export function saveWhatsappDraft(data = {}) {
  const payload = normalizeWhatsapp(data);
  const result = statements.whatsappInsert.run(payload);
  return parseWhatsapp(statements.whatsappGet.get({ ...payload, id: Number(result.lastInsertRowid) }));
}

export function updateWhatsappDraft(data = {}) {
  const payload = normalizeWhatsapp(data);
  if (!payload.id) throw new Error("valid draft id is required");
  statements.whatsappUpdate.run(payload);
  return parseWhatsapp(statements.whatsappGet.get(payload));
}

export function createWhatsappDraftFromRule(data = {}) {
  const current = requireScope(data);
  const ruleId = idFrom(data.ruleId);
  if (!ruleId) throw new Error("valid rule id is required");
  const rule = discountRulesRepo.getById({ ...current, id: ruleId });
  if (!rule) throw new Error("discount rule not found");
  const action = rule.actionJson || parseJson(rule.action, {});
  const target = data.target || { segment: data.segment || "eligible_clients" };
  const title = shortText(data.title, `${rule.name} campaign`);
  const message = shortText(
    data.message,
    `Hi {{name}}, ${rule.name} is live at Aura. Get ${actionSummary(action)} before it ends. Book your slot today.`,
    1200
  );
  return saveWhatsappDraft({
    ...current,
    ruleId,
    title,
    message,
    target,
    status: "draft",
    scheduledFor: data.scheduledFor || null,
    createdBy: data.createdBy
  });
}

function recordAbuseAlert(data = {}) {
  const payload = {
    ...requireScope(data),
    signature: shortText(data.signature, `${data.alertType}:${data.title}`, 200),
    alertType: shortText(data.alertType, "discount_abuse", 80),
    severity: severity(data.severity),
    status: alertStatus(data.status),
    title: shortText(data.title, "Discount abuse alert", 200),
    description: shortText(data.description, "", 1000),
    evidenceJson: jsonText(data.evidence ?? data.evidenceJson, {}),
    detectedAt: intValue(data.detectedAt, Math.floor(Date.now() / 1000))
  };
  statements.abuseUpsert.run(payload);
  return parseAlert(statements.abuseGetBySignature.get(payload));
}

export function scanAbuseAlerts(scope = {}) {
  const current = requireScope(scope);
  const rows = auditRows(scope);
  const created = [];
  const byClient = new Map();
  const byActor = new Map();
  for (const row of rows) {
    if (row.eventType !== "discount_applied") continue;
    const clientId = row.metadata?.clientId || "";
    const actor = row.actorUserId || row.metadata?.staffId || "";
    if (clientId) {
      const entry = byClient.get(clientId) || { count: 0, discountPaise: 0 };
      entry.count += 1;
      entry.discountPaise += intPaise(row.discountPaise);
      byClient.set(clientId, entry);
    }
    if (row.metadata?.manualOverride || String(row.source || "").includes("manual")) {
      const entry = byActor.get(actor || "unknown") || { count: 0, discountPaise: 0 };
      entry.count += 1;
      entry.discountPaise += intPaise(row.discountPaise);
      byActor.set(actor || "unknown", entry);
    }
  }
  for (const [clientId, entry] of byClient.entries()) {
    if (entry.count >= 3) {
      created.push(recordAbuseAlert({
        ...current,
        signature: `repeat_client:${clientId}`,
        alertType: "repeat_client_discount_use",
        severity: entry.count >= 6 ? "high" : "medium",
        title: `Repeated discount use by ${clientId}`,
        description: "Same client used discounts multiple times in the selected period.",
        evidence: entry
      }));
    }
  }
  for (const [actor, entry] of byActor.entries()) {
    if (entry.count >= 3) {
      created.push(recordAbuseAlert({
        ...current,
        signature: `manual_override:${actor}`,
        alertType: "manual_discount_override",
        severity: entry.count >= 6 ? "high" : "medium",
        title: `Manual discount override spike by ${actor}`,
        description: "Manual discount overrides crossed the configured review threshold.",
        evidence: entry
      }));
    }
  }
  const couponOveruse = db.prepare(`
    SELECT c.id, c.code, c.usageLimit, c.usedCount
    FROM discountCoupons c
    WHERE c.tenantId = @tenantId
      AND c.branchId = @branchId
      AND c.usageLimit > 0
      AND c.usedCount > c.usageLimit
  `).all(current);
  for (const coupon of couponOveruse) {
    created.push(recordAbuseAlert({
      ...current,
      signature: `coupon_overuse:${coupon.id}`,
      alertType: "coupon_usage_limit_breach",
      severity: "critical",
      title: `${coupon.code} crossed usage limit`,
      description: "Coupon used count is higher than its configured usage limit.",
      evidence: coupon
    }));
  }
  return { scanned: rows.length, created };
}

export function listAbuseAlerts(scope = {}) {
  const current = requireScope(scope);
  const limit = Math.min(500, Math.max(1, intValue(scope.limit, 100)));
  const offset = Math.max(0, intValue(scope.offset, 0));
  const rows = db.prepare(`
    SELECT *
    FROM discountAbuseAlerts
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND (@status IS NULL OR status = @status)
      AND (@severity IS NULL OR severity = @severity)
    ORDER BY detectedAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all({
    ...current,
    status: scope.status || null,
    severity: scope.severity || null,
    limit,
    offset
  }).map(parseAlert);
  return { rows, limit, offset };
}

export function reviewAbuseAlert(data = {}) {
  const current = requireScope(data);
  const id = idFrom(data.id);
  if (!id) throw new Error("valid alert id is required");
  statements.abuseReview.run({
    ...current,
    id,
    status: alertStatus(data.status, "reviewed"),
    reviewedBy: data.reviewedBy || null,
    reviewNote: shortText(data.reviewNote || data.note, "", 500)
  });
  return parseAlert(statements.abuseGet.get({ ...current, id }));
}

export function listTemplates(scope = {}) {
  const current = requireScope(scope);
  ensureDefaultTemplates(current);
  return simpleList("offerTemplates", parseTemplate, { ...current, ...scope }, "AND status = 'active'");
}

export function createRuleFromTemplate(data = {}) {
  const current = requireScope(data);
  ensureDefaultTemplates(current);
  const templateKey = shortText(data.templateKey, "", 80);
  const template = parseTemplate(statements.templateByKey.get({ ...current, templateKey }));
  if (!template) throw new Error("offer template not found");
  const rule = discountRulesRepo.create({
    ...current,
    name: data.name || template.name,
    description: data.description || template.description,
    conditions: template.conditions,
    conditionLogic: "AND",
    action: template.action,
    priority: intValue(data.priority, 100),
    stackable: false,
    status: "draft",
    validFrom: data.validFrom || null,
    validTo: data.validTo || null,
    createdBy: data.createdBy || null
  });
  return { template, rule };
}

export function publicOffers(scope = {}) {
  const current = publicContext(scope);
  const labels = whiteLabelRulesRepo.resolvePublicLabels(current);
  const rules = discountRulesRepo.getActiveRules(current).filter((rule) => matchesRuleTarget(rule, current)).map((rule) => ({
    type: "discount_rule",
    id: rule.id,
    title: publicRuleTitle(labels, rule),
    description: labels.labels?.discountBadge || "Special offer",
    discountSummary: actionSummary(rule.actionJson || {}),
    applyTo: rule.actionJson?.applyTo || "cart",
    validFrom: rule.validFrom,
    validTo: rule.validTo
  }));
  const coupons = activeCoupons(current)
    .filter((coupon) => coupon.target?.publicVisible !== false)
    .filter((coupon) => matchesAudienceTarget(coupon.target || {}, current))
    .map((coupon) => ({
      type: "coupon",
      id: coupon.id,
      code: coupon.code,
      title: coupon.title,
      description: labels.labels?.discountBadge || "Special offer",
      discountSummary: coupon.discountType === "flat" ? `Rs ${Math.round(coupon.discountValue / 100)} off` : `${coupon.discountValue}% off`,
      validFrom: coupon.validFrom,
      validTo: coupon.validTo
    }));
  const calendar = activeCalendar(current).filter((event) => matchesAudienceTarget(event.audience || {}, current)).map((event) => ({
    type: "calendar_promotion",
    id: event.id,
    title: event.title,
    description: event.notes || labels.labels?.limitedTime || "Limited-time price",
    promoType: event.promoType,
    startDate: event.startDate,
    endDate: event.endDate,
    startTime: event.startTime,
    endTime: event.endTime
  }));
  return {
    tenantId: current.tenantId,
    branchId: current.branchId,
    safeForPublicSurfaces: true,
    eligibility: {
      currentDate: current.currentDate,
      serviceId: current.serviceId,
      serviceCategory: current.serviceCategory,
      staffId: current.staffId,
      clientSegment: current.clientSegment,
      cartTotalPaise: current.cartTotalPaise
    },
    labels: labels.labels,
    offers: [...calendar, ...coupons, ...rules],
    generatedAt: new Date().toISOString()
  };
}

export const happyHoursControlTowerRepo = {
  getSummary,
  listCalendar,
  saveCalendar,
  updateCalendar,
  deleteCalendar,
  listCoupons,
  saveCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  recordCouponUse,
  getOfferRoi,
  recordRoiOutcome,
  listSegments,
  saveSegment,
  updateSegment,
  deleteSegment,
  evaluateSegments,
  listStaffIncentives,
  saveStaffIncentive,
  updateStaffIncentive,
  listWhatsappDrafts,
  saveWhatsappDraft,
  updateWhatsappDraft,
  createWhatsappDraftFromRule,
  scanAbuseAlerts,
  listAbuseAlerts,
  reviewAbuseAlert,
  listTemplates,
  createRuleFromTemplate,
  publicOffers
};
