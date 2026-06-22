import { createHash } from "node:crypto";
import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS offerExperiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    clientId INTEGER NOT NULL,
    offerType TEXT NOT NULL,
    assignment TEXT NOT NULL,
    assignedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    booked INTEGER DEFAULT NULL,
    revenuePaise INTEGER NOT NULL DEFAULT 0,
    discountPaise INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    observedAt INTEGER DEFAULT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_offerExp ON offerExperiments(tenantId, branchId, offerType, assignment);
  CREATE INDEX IF NOT EXISTS idx_offerExp_client ON offerExperiments(tenantId, branchId, clientId, offerType, booked);
  CREATE INDEX IF NOT EXISTS idx_offerExp_assigned ON offerExperiments(tenantId, branchId, assignedAt);

  CREATE TABLE IF NOT EXISTS upliftScores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    clientId INTEGER NOT NULL,
    upliftScore REAL NOT NULL,
    segment TEXT NOT NULL,
    computedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_uplift ON upliftScores(tenantId, branchId, clientId);
  CREATE INDEX IF NOT EXISTS idx_uplift_segment ON upliftScores(tenantId, branchId, segment);
`);

function ensureColumn(tableName, columnName, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  if (!columns.includes(columnName)) db.exec(ddl);
}

ensureColumn("offerExperiments", "discountPaise", "ALTER TABLE offerExperiments ADD COLUMN discountPaise INTEGER NOT NULL DEFAULT 0");
ensureColumn("offerExperiments", "metadata", "ALTER TABLE offerExperiments ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");

const VALID_ASSIGNMENTS = new Set(["treatment", "holdout"]);
const VALID_SEGMENTS = new Set(["persuadable", "sure_thing", "lost_cause", "sleeping_dog"]);

const statements = {
  pendingAssignment: db.prepare(`
    SELECT * FROM offerExperiments
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND clientId = @clientId
      AND offerType = @offerType
      AND booked IS NULL
    ORDER BY assignedAt DESC, id DESC
    LIMIT 1
  `),
  insertAssignment: db.prepare(`
    INSERT INTO offerExperiments (
      tenantId, branchId, clientId, offerType, assignment, discountPaise, metadata
    )
    VALUES (
      @tenantId, @branchId, @clientId, @offerType, @assignment, @discountPaise, @metadata
    )
  `),
  getExperimentById: db.prepare(`
    SELECT * FROM offerExperiments
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  updateOutcome: db.prepare(`
    UPDATE offerExperiments
    SET booked = @booked,
        revenuePaise = @revenuePaise,
        discountPaise = @discountPaise,
        observedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `),
  upsertScore: db.prepare(`
    INSERT INTO upliftScores (
      tenantId, branchId, clientId, upliftScore, segment
    )
    VALUES (
      @tenantId, @branchId, @clientId, @upliftScore, @segment
    )
    ON CONFLICT(tenantId, branchId, clientId) DO UPDATE SET
      upliftScore = excluded.upliftScore,
      segment = excluded.segment,
      computedAt = strftime('%s','now')
  `),
  getScore: db.prepare(`
    SELECT * FROM upliftScores
    WHERE tenantId = @tenantId AND branchId = @branchId AND clientId = @clientId
  `),
  segmentCounts: db.prepare(`
    SELECT segment, COUNT(*) AS count
    FROM upliftScores
    WHERE tenantId = @tenantId AND branchId = @branchId
    GROUP BY segment
    ORDER BY count DESC
  `)
};

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function normalizeClientId(value) {
  const clientId = Number.parseInt(value, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) throw new Error("valid clientId is required");
  return clientId;
}

function normalizeOfferType(value) {
  const offerType = String(value || "happy_hours").trim();
  if (!offerType) throw new Error("offerType is required");
  return offerType;
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function jsonText(value, fallback = {}) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseExperiment(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: parseJson(row.metadata, {})
  };
}

function parseScore(row) {
  if (!row) return null;
  return row;
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

function assignmentFor(data = {}) {
  const holdoutPercent = Math.min(50, Math.max(1, Number.parseInt(data.holdoutPercent, 10) || 15));
  const key = `${data.tenantId}:${data.branchId}:${data.offerType}:${data.clientId}`;
  const bucket = Number.parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) % 100;
  return bucket < holdoutPercent ? "holdout" : "treatment";
}

function reportRowsSql({ offerType }) {
  return `
    SELECT assignment,
           COUNT(*) AS totalAssigned,
           SUM(CASE WHEN booked IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
           SUM(CASE WHEN booked = 1 THEN 1 ELSE 0 END) AS bookings,
           SUM(CASE WHEN booked = 1 THEN revenuePaise ELSE 0 END) AS revenuePaise,
           SUM(CASE WHEN assignment = 'treatment' THEN discountPaise ELSE 0 END) AS discountSpentPaise
    FROM offerExperiments
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND assignedAt >= @fromTs
      AND assignedAt <= @toTs
      ${offerType ? "AND offerType = @offerType" : ""}
    GROUP BY assignment
  `;
}

function reportDefaults(assignment) {
  return {
    assignment,
    totalAssigned: 0,
    resolved: 0,
    bookings: 0,
    revenuePaise: 0,
    discountSpentPaise: 0
  };
}

function rate(bookings, denominator) {
  return denominator > 0 ? bookings / denominator : 0;
}

function roundMoney(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

export function assignToGroup(data = {}) {
  const scope = normalizeScope(data);
  const clientId = normalizeClientId(data.clientId);
  const offerType = normalizeOfferType(data.offerType);
  const pending = statements.pendingAssignment.get({ ...scope, clientId, offerType });
  if (pending) return parseExperiment(pending);
  const assignment = VALID_ASSIGNMENTS.has(data.assignment) ? data.assignment : assignmentFor({ ...scope, clientId, offerType, holdoutPercent: data.holdoutPercent });
  const payload = {
    ...scope,
    clientId,
    offerType,
    assignment,
    discountPaise: assignment === "treatment" ? intPaise(data.discountPaise) : 0,
    metadata: jsonText({
      holdoutPercent: Math.min(50, Math.max(1, Number.parseInt(data.holdoutPercent, 10) || 15)),
      reason: data.reason || "causal_incrementality_holdout"
    })
  };
  const result = statements.insertAssignment.run(payload);
  return parseExperiment(statements.getExperimentById.get({ ...scope, id: Number(result.lastInsertRowid) }));
}

export function recordExperimentOutcome(data = {}) {
  const scope = normalizeScope(data);
  const id = Number.parseInt(data.id, 10);
  if (!id) throw new Error("valid experiment id is required");
  const current = statements.getExperimentById.get({ ...scope, id });
  if (!current) return null;
  statements.updateOutcome.run({
    ...scope,
    id,
    booked: data.booked ? 1 : 0,
    revenuePaise: intPaise(data.revenuePaise),
    discountPaise: data.discountPaise === undefined ? intPaise(current.discountPaise) : intPaise(data.discountPaise)
  });
  return parseExperiment(statements.getExperimentById.get({ ...scope, id }));
}

export function getIncrementalityReport(scope = {}) {
  const current = normalizeScope(scope);
  const offerType = String(scope.offerType || "").trim();
  const params = {
    ...current,
    offerType,
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to)
  };
  const rows = db.prepare(reportRowsSql({ offerType })).all(params);
  const byAssignment = new Map(rows.map((row) => [row.assignment, row]));
  const treatment = { ...reportDefaults("treatment"), ...(byAssignment.get("treatment") || {}) };
  const holdout = { ...reportDefaults("holdout"), ...(byAssignment.get("holdout") || {}) };
  const treatmentBase = Number(treatment.resolved || 0);
  const holdoutBase = Number(holdout.resolved || 0);
  const treatmentBookingRate = rate(Number(treatment.bookings || 0), treatmentBase);
  const holdoutBookingRate = rate(Number(holdout.bookings || 0), holdoutBase);
  const incrementalLift = treatmentBase && holdoutBase ? treatmentBookingRate - holdoutBookingRate : 0;
  const positiveLift = Math.max(0, incrementalLift);
  const incrementalBookings = Math.round(positiveLift * treatmentBase);
  const avgTreatmentRevenuePaise = Number(treatment.bookings || 0) > 0 ? Number(treatment.revenuePaise || 0) / Number(treatment.bookings || 1) : 0;
  const discountSpentPaise = intPaise(treatment.discountSpentPaise);
  const avgDiscountPerBookedTreatment = Number(treatment.bookings || 0) > 0 ? discountSpentPaise / Number(treatment.bookings || 1) : 0;
  const expectedBaselineBookings = Math.max(0, holdoutBookingRate * treatmentBase);
  const wastedDiscountPaise = roundMoney(expectedBaselineBookings * avgDiscountPerBookedTreatment);
  const trueIncrementalRevenuePaise = roundMoney(incrementalBookings * avgTreatmentRevenuePaise);
  const apparentROI = discountSpentPaise > 0 ? Number(treatment.revenuePaise || 0) / discountSpentPaise : null;
  const trueROI = discountSpentPaise > 0 ? trueIncrementalRevenuePaise / discountSpentPaise : null;
  const segments = statements.segmentCounts.all(current);
  const resolvedTotal = treatmentBase + holdoutBase;
  return {
    offerType: offerType || "all",
    from: scope.from || null,
    to: scope.to || null,
    treatment,
    holdout,
    treatmentBookingRate,
    holdoutBookingRate,
    incrementalLift,
    incrementalBookings,
    discountSpentPaise,
    trueIncrementalRevenuePaise,
    wastedDiscountPaise,
    trueROI,
    apparentROI,
    segments,
    readiness: {
      readyForUpliftModel: treatmentBase >= 50 && holdoutBase >= 10,
      resolvedOutcomes: resolvedTotal,
      minimumTreatmentOutcomes: 50,
      minimumHoldoutOutcomes: 10,
      note: resolvedTotal ? "Report uses recorded experiment outcomes." : "No resolved offer experiments yet; start assignment/outcome capture before ML uplift training."
    },
    notes: {
      discountSpent: "Uses recorded discountPaise; missing values remain 0.",
      wastedDiscount: "Estimated from holdout booking rate and treatment discount spend; exact client-level waste requires uplift scores."
    }
  };
}

export function upsertUpliftScore(data = {}) {
  const scope = normalizeScope(data);
  const clientId = normalizeClientId(data.clientId);
  const segment = VALID_SEGMENTS.has(data.segment) ? data.segment : "lost_cause";
  const upliftScore = Math.min(1, Math.max(0, Number(data.upliftScore || 0)));
  statements.upsertScore.run({ ...scope, clientId, segment, upliftScore });
  return parseScore(statements.getScore.get({ ...scope, clientId }));
}

export function getUpliftScore(scope = {}) {
  const current = normalizeScope(scope);
  const clientId = normalizeClientId(scope.clientId);
  return parseScore(statements.getScore.get({ ...current, clientId }));
}

export const incrementalityRepo = {
  assignToGroup,
  recordExperimentOutcome,
  getIncrementalityReport,
  upsertUpliftScore,
  getUpliftScore
};
