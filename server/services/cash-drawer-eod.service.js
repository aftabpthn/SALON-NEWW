import { randomUUID } from "node:crypto";
import { columnsFor, db } from "../db.js";
import { badRequest, conflict, notFound } from "../utils/app-error.js";
import { tenantService } from "./tenant.service.js";
import { ensureCashDrawerEodSchema } from "./cash-drawer-eod-schema.service.js";
import { balanceSheetService } from "./balance-sheet.service.js";
import { ensureBalanceSheetSchema } from "./balance-sheet-schema.service.js";

const MODES = ["cash", "card", "gpay", "phonepe", "paytm", "upi", "online", "other"];
const NON_CASH_MODES = new Set(["card", "gpay", "phonepe", "paytm", "upi", "online", "other"]);
const CASH_OPERATION_TYPES = new Set(["drop", "pickup", "payout"]);
const CASHIER_ROLES = new Set(["cashier", "frontDesk", "receptionist", "staff"]);
const OVERRIDE_ROLES = new Set(["owner", "admin", "manager", "superAdmin"]);
const VAT_COUNTRIES = new Set(["AE", "SA", "BH", "KW", "OM", "QA"]);
const DENOMINATIONS = [
  { denominationPaise: 200000, kind: "note" },
  { denominationPaise: 50000, kind: "note" },
  { denominationPaise: 20000, kind: "note" },
  { denominationPaise: 10000, kind: "note" },
  { denominationPaise: 5000, kind: "note" },
  { denominationPaise: 2000, kind: "note" },
  { denominationPaise: 1000, kind: "note" },
  { denominationPaise: 500, kind: "note" },
  { denominationPaise: 2000, kind: "coin" },
  { denominationPaise: 1000, kind: "coin" },
  { denominationPaise: 500, kind: "coin" },
  { denominationPaise: 200, kind: "coin" },
  { denominationPaise: 100, kind: "coin" }
];

const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 12)}`;
const now = () => new Date().toISOString();
const istBusinessDate = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const toInteger = (value) => Math.round(Number(value) || 0);
const rupeesToPaise = (value) => Math.round((Number(value) || 0) * 100);
const paiseToRupees = (value) => Math.round((Number(value) || 0)) / 100;

function tableColumns(table) {
  try {
    return columnsFor(table);
  } catch {
    return [];
  }
}

function hasTable(table) {
  return tableColumns(table).length > 0;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, "\"\"")}"`;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeMode(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "other";
  if (text.includes("cash")) return "cash";
  if (text.includes("gpay") || text.includes("google")) return "gpay";
  if (text.includes("phonepe")) return "phonepe";
  if (text.includes("paytm")) return "paytm";
  if (text.includes("upi") || text.includes("bhim")) return "upi";
  if (text.includes("card") || text.includes("debit") || text.includes("credit") || text.includes("edc")) return "card";
  if (text.includes("online") || text.includes("razorpay") || text.includes("link") || text.includes("wallet")) return "online";
  return MODES.includes(text) ? text : "other";
}

function currencyToPaise(value = "") {
  if (typeof value === "number") return rupeesToPaise(value);
  const cleaned = String(value || "").replace(/,/g, "").replace(/[^\d.-]/g, "");
  return rupeesToPaise(cleaned);
}

function amountPaiseFromRow(row = {}, paiseKeys = [], rupeeKeys = []) {
  for (const key of paiseKeys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return toInteger(row[key]);
  }
  for (const key of rupeeKeys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return rupeesToPaise(row[key]);
  }
  return 0;
}

function selectColumn(columns, candidates, alias, fallback = "NULL") {
  const found = candidates.find((candidate) => columns.includes(candidate));
  return `${found ? `i.${quoteIdentifier(found)}` : fallback} AS ${alias}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text = "") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function rowValue(row, keys = []) {
  for (const key of keys) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (row[normalized] !== undefined && row[normalized] !== "") return row[normalized];
  }
  return "";
}

function plusDays(dateText, days) {
  const date = new Date(`${dateText || istBusinessDate()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function plusHoursIso(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function whatsappDeepLink(recipient = "", message = "") {
  const digits = String(recipient || "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function isCashMode(mode) {
  return normalizeMode(mode) === "cash";
}

function isCashier(access = {}) {
  return CASHIER_ROLES.has(access.role || "");
}

function canOverride(access = {}) {
  return OVERRIDE_ROLES.has(access.role || "");
}

function riskLevel(score) {
  if (score >= 80) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function normalizeCashOperationType(value = "") {
  const type = String(value || "").trim().toLowerCase();
  if (!CASH_OPERATION_TYPES.has(type)) throw badRequest("Cash operation type must be drop, pickup or payout");
  return type;
}

function cashOperationImpact(type, amountPaise) {
  if (type === "pickup") return amountPaise;
  return -amountPaise;
}

function allowedDenomination(denominationPaise, kind) {
  return DENOMINATIONS.some((item) => item.denominationPaise === denominationPaise && item.kind === kind);
}

function defaultDenominationKind(denominationPaise) {
  return DENOMINATIONS.find((item) => item.denominationPaise === denominationPaise)?.kind || "";
}

function getBranchId(input = {}, access = {}) {
  const branchId = input.branchId || input.branch_id || access.branchId || access.requestedBranchId || "";
  if (!access.tenantId) throw badRequest("tenantId is required");
  if (!branchId) throw badRequest("branchId is required");
  tenantService.assertBranchAccess(access, branchId);
  return branchId;
}

export class CashDrawerEodService {
  constructor() {
    ensureCashDrawerEodSchema();
  }

  getSettings(branchId, access = {}) {
    ensureCashDrawerEodSchema();
    const row = db.prepare(
      `SELECT *
         FROM cashDrawerEodSettings
        WHERE tenantId = @tenantId AND branchId = @branchId`
    ).get({ tenantId: access.tenantId, branchId });
    return row || {
      tenantId: access.tenantId,
      branchId,
      blindClose: 1,
      reportChannel: "whatsapp,inapp",
      ownerRecipient: ""
    };
  }

  open(payload = {}, access = {}) {
    ensureCashDrawerEodSchema();
    const branchId = getBranchId(payload, access);
    const businessDate = payload.businessDate || payload.business_date || payload.date || istBusinessDate();
    const existing = db.prepare(
      `SELECT id, status
         FROM cash_drawer_sessions
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND businessDate = @businessDate
        LIMIT 1`
    ).get({ tenantId: access.tenantId, branchId, businessDate });
    if (existing) return this.summary(existing.id, access);

    const openSession = db.prepare(
      `SELECT id
         FROM cash_drawer_sessions
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND status = 'open'
        LIMIT 1`
    ).get({ tenantId: access.tenantId, branchId });
    if (openSession) return this.summary(openSession.id, access);

    const previous = this.previousClosedSession(branchId, businessDate, access);
    const openingBalancePaise = toInteger(payload.openingBalancePaise ?? payload.opening_balance_paise ?? previous?.countedCashPaise ?? 0);
    const settings = this.getSettings(branchId, access);
    const stamp = now();
    const id = makeId("eoddrawer");

    db.prepare(
      `INSERT INTO cash_drawer_sessions
        (id, tenant_id, branch_id, cashier_id, terminal_id, opening_cash, closing_cash, expected_cash, cash_difference,
         status, opened_at, closed_at, businessDate, openingBalancePaise, openedBy, cashCollectedPaise, cashPayoutPaise,
         expectedCashPaise, countedCashPaise, variancePaise, varianceReason, notes, blindClose)
       VALUES
        (@id, @tenantId, @branchId, @cashierId, @terminalId, @openingCash, 0, @openingCash, 0,
         'open', @openedAt, '', @businessDate, @openingBalancePaise, @openedBy, 0, 0,
         @openingBalancePaise, 0, @negativeOpening, '', @notes, @blindClose)`
    ).run({
      id,
      tenantId: access.tenantId,
      branchId,
      cashierId: access.userId || payload.openedBy || "",
      terminalId: payload.terminalId || payload.terminal_id || "",
      openingCash: paiseToRupees(openingBalancePaise),
      openedAt: stamp,
      businessDate,
      openingBalancePaise,
      openedBy: access.userId || payload.openedBy || "",
      negativeOpening: -openingBalancePaise,
      notes: payload.notes || "",
      blindClose: Number(settings.blindClose ?? 1)
    });

    this.ensureDefaultTill(this.requireSession(id, access), access);
    return this.summary(id, access);
  }

  current(query = {}, access = {}) {
    ensureCashDrawerEodSchema();
    const branchId = getBranchId(query, access);
    const businessDate = query.businessDate || query.business_date || query.date || "";
    let row = businessDate
      ? db.prepare(
        `SELECT *
           FROM cash_drawer_sessions
          WHERE tenant_id = @tenantId AND branch_id = @branchId AND businessDate = @businessDate
          ORDER BY opened_at DESC LIMIT 1`
      ).get({ tenantId: access.tenantId, branchId, businessDate })
      : db.prepare(
        `SELECT *
           FROM cash_drawer_sessions
          WHERE tenant_id = @tenantId AND branch_id = @branchId AND status = 'open'
          ORDER BY opened_at DESC LIMIT 1`
      ).get({ tenantId: access.tenantId, branchId });

    if (!row && businessDate) {
      row = db.prepare(
        `SELECT *
           FROM cash_drawer_sessions
          WHERE tenant_id = @tenantId AND branch_id = @branchId AND status = 'open'
          ORDER BY opened_at DESC LIMIT 1`
      ).get({ tenantId: access.tenantId, branchId });
    }

    if (!row) {
      const date = businessDate || istBusinessDate();
      const previous = this.previousClosedSession(branchId, date, access);
      return {
        session: null,
        suggestedOpeningBalancePaise: Number(previous?.countedCashPaise || 0),
        businessDate: date,
        settings: this.getSettings(branchId, access)
      };
    }
    this.syncCollections(row, access);
    return {
      session: this.summary(row.id, access),
      suggestedOpeningBalancePaise: Number(row.countedCashPaise || row.openingBalancePaise || 0),
      businessDate: row.businessDate || businessDate || istBusinessDate(),
      settings: this.getSettings(branchId, access)
    };
  }

  setCash(sessionId, payload = {}, access = {}) {
    const session = this.requireSession(sessionId, access);
    this.assertOpen(session);
    this.syncCollections(session, access);
    const collections = Array.isArray(payload.collections) ? payload.collections : [];
    for (const item of collections) {
      this.setCollection(session, item, access);
    }
    if (payload.cashCollectedPaise !== undefined || payload.cash_collected_paise !== undefined) {
      this.setCollection(session, {
        mode: "cash",
        finalAmountPaise: payload.cashCollectedPaise ?? payload.cash_collected_paise,
        adjustmentReason: payload.adjustmentReason || payload.reason || "Manual cash drawer adjustment"
      }, access);
    }
    const cashPayoutPaise = toInteger(payload.cashPayoutPaise ?? payload.cash_payout_paise ?? session.cashPayoutPaise ?? 0);
    db.prepare(
      `UPDATE cash_drawer_sessions
          SET cashPayoutPaise = @cashPayoutPaise,
              notes = COALESCE(NULLIF(@notes, ''), notes)
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: session.branch_id,
      id: session.id,
      cashPayoutPaise,
      notes: payload.notes || ""
    });
    this.recalculateSession(session.id, access);
    return this.summary(session.id, access);
  }

  listCashOperations(sessionId, access = {}) {
    const session = this.requireSession(sessionId, access);
    return { operations: this.cashOperations(session), totals: this.operationTotals(session) };
  }

  createCashOperation(sessionId, payload = {}, access = {}) {
    const session = this.requireSession(sessionId, access);
    this.assertOpen(session);
    const type = normalizeCashOperationType(payload.type);
    const amountPaise = toInteger(payload.amountPaise ?? payload.amount_paise);
    if (amountPaise <= 0) throw badRequest("amountPaise must be greater than 0");
    const reason = String(payload.reason || "").trim();
    if (!reason) throw badRequest("reason is required");
    const tillId = this.resolveTillId(session, payload.tillId || payload.till_id || "", access);
    const stamp = now();
    db.prepare(
      `INSERT INTO cashDrawerEodCashOperations
        (id, tenantId, branchId, sessionId, tillId, type, amountPaise, impactPaise, reason, entryBy, entryAt, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @tillId, @type, @amountPaise, @impactPaise, @reason, @entryBy, @entryAt, @createdAt, @updatedAt)`
    ).run({
      id: makeId("cashop"),
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      tillId,
      type,
      amountPaise,
      impactPaise: cashOperationImpact(type, amountPaise),
      reason,
      entryBy: access.userId || "",
      entryAt: payload.entryAt || payload.entry_at || stamp,
      createdAt: stamp,
      updatedAt: stamp
    });
    this.recalculateSession(session.id, access);
    return this.summary(session.id, access);
  }

  updateCashOperation(operationId, payload = {}, access = {}) {
    const operation = this.requireCashOperation(operationId, access);
    const session = this.requireSession(operation.sessionId, access);
    this.assertOpen(session);
    const type = payload.type ? normalizeCashOperationType(payload.type) : operation.type;
    const amountPaise = payload.amountPaise === undefined && payload.amount_paise === undefined
      ? Number(operation.amountPaise || 0)
      : toInteger(payload.amountPaise ?? payload.amount_paise);
    if (amountPaise <= 0) throw badRequest("amountPaise must be greater than 0");
    const reason = String(payload.reason ?? operation.reason ?? "").trim();
    if (!reason) throw badRequest("reason is required");
    const tillId = this.resolveTillId(session, payload.tillId || payload.till_id || operation.tillId || "", access);
    db.prepare(
      `UPDATE cashDrawerEodCashOperations
          SET tillId = @tillId,
              type = @type,
              amountPaise = @amountPaise,
              impactPaise = @impactPaise,
              reason = @reason,
              updatedAt = @updatedAt
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: session.branch_id,
      id: operationId,
      tillId,
      type,
      amountPaise,
      impactPaise: cashOperationImpact(type, amountPaise),
      reason,
      updatedAt: now()
    });
    this.recalculateSession(session.id, access);
    return this.summary(session.id, access);
  }

  deleteCashOperation(operationId, access = {}) {
    const operation = this.requireCashOperation(operationId, access);
    const session = this.requireSession(operation.sessionId, access);
    this.assertOpen(session);
    db.prepare(
      `DELETE FROM cashDrawerEodCashOperations
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
    ).run({ tenantId: access.tenantId, branchId: session.branch_id, id: operationId });
    this.recalculateSession(session.id, access);
    return this.summary(session.id, access);
  }

  createTill(sessionId, payload = {}, access = {}) {
    const session = this.requireSession(sessionId, access);
    this.assertOpen(session);
    const stamp = now();
    const existingCount = db.prepare(
      `SELECT COUNT(*) AS total
         FROM cashDrawerEodTills
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    const tillName = String(payload.tillName || payload.till_name || `Till ${Number(existingCount?.total || 0) + 1}`).trim();
    if (!tillName) throw badRequest("tillName is required");
    const openingFloatPaise = toInteger(payload.openingFloatPaise ?? payload.opening_float_paise ?? 0);
    const id = makeId("till");
    db.prepare(
      `INSERT INTO cashDrawerEodTills
        (id, tenantId, branchId, sessionId, tillName, cashierId, openingFloatPaise, expectedCashPaise,
         status, openedBy, openedAt, notes, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @tillName, @cashierId, @openingFloatPaise, @openingFloatPaise,
         'open', @openedBy, @openedAt, @notes, @createdAt, @updatedAt)`
    ).run({
      id,
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      tillName,
      cashierId: payload.cashierId || payload.cashier_id || access.userId || "",
      openingFloatPaise,
      openedBy: access.userId || "",
      openedAt: stamp,
      notes: payload.notes || "",
      createdAt: stamp,
      updatedAt: stamp
    });
    if (!session.primaryTillId) {
      db.prepare(
        `UPDATE cash_drawer_sessions
            SET primaryTillId = @primaryTillId
          WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
      ).run({ tenantId: access.tenantId, branchId: session.branch_id, id: session.id, primaryTillId: id });
    }
    this.recalculateTills(this.requireSession(session.id, access), access);
    return this.summary(session.id, access);
  }

  closeTill(tillId, payload = {}, access = {}) {
    const till = this.requireTill(tillId, access);
    const session = this.requireSession(till.sessionId, access);
    this.assertOpen(session);
    const cashCollectedPaise = payload.cashCollectedPaise === undefined && payload.cash_collected_paise === undefined
      ? Number(till.cashCollectedPaise || 0)
      : toInteger(payload.cashCollectedPaise ?? payload.cash_collected_paise);
    db.prepare(
      `UPDATE cashDrawerEodTills
          SET cashCollectedPaise = @cashCollectedPaise,
              updatedAt = @updatedAt
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
    ).run({ tenantId: access.tenantId, branchId: till.branchId, id: till.id, cashCollectedPaise, updatedAt: now() });
    this.recalculateTills(session, access);
    const fresh = this.requireTill(tillId, access);
    const countedCashPaise = toInteger(payload.countedCashPaise ?? payload.counted_cash_paise ?? fresh.expectedCashPaise ?? 0);
    db.prepare(
      `UPDATE cashDrawerEodTills
          SET countedCashPaise = @countedCashPaise,
              variancePaise = @variancePaise,
              status = 'closed',
              closedBy = @closedBy,
              closedAt = @closedAt,
              notes = COALESCE(NULLIF(@notes, ''), notes),
              updatedAt = @updatedAt
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: fresh.branchId,
      id: fresh.id,
      countedCashPaise,
      variancePaise: countedCashPaise - Number(fresh.expectedCashPaise || 0),
      closedBy: access.userId || "",
      closedAt: now(),
      notes: payload.notes || "",
      updatedAt: now()
    });
    return this.summary(session.id, access);
  }

  handover(sessionId, payload = {}, access = {}) {
    const session = this.requireSession(sessionId, access);
    this.assertOpen(session);
    const tillId = this.resolveTillId(session, payload.tillId || payload.till_id || "", access);
    const till = this.requireTill(tillId, access);
    const incomingCashierId = String(payload.incomingCashierId || payload.incoming_cashier_id || "").trim();
    const signature = String(payload.signature || "").trim();
    if (!incomingCashierId) throw badRequest("incomingCashierId is required");
    if (!signature) throw badRequest("signature is required");
    const countBreakdown = Array.isArray(payload.denominations) ? payload.denominations : Array.isArray(payload.countBreakdown) ? payload.countBreakdown : [];
    const countedCashPaise = countBreakdown.length
      ? countBreakdown.reduce((sum, row) => sum + toInteger(row.denominationPaise ?? row.denomination_paise) * Math.max(0, toInteger(row.qty)), 0)
      : toInteger(payload.countedCashPaise ?? payload.counted_cash_paise ?? 0);
    const stamp = now();
    db.prepare(
      `INSERT INTO cashDrawerEodHandovers
        (id, tenantId, branchId, sessionId, tillId, outgoingCashierId, incomingCashierId, countedCashPaise,
         countBreakdown, signature, notes, handedOverAt, createdAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @tillId, @outgoingCashierId, @incomingCashierId, @countedCashPaise,
         @countBreakdown, @signature, @notes, @handedOverAt, @createdAt)`
    ).run({
      id: makeId("handover"),
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      tillId,
      outgoingCashierId: payload.outgoingCashierId || payload.outgoing_cashier_id || till.cashierId || access.userId || "",
      incomingCashierId,
      countedCashPaise,
      countBreakdown: JSON.stringify(countBreakdown),
      signature,
      notes: payload.notes || "",
      handedOverAt: payload.handedOverAt || payload.handed_over_at || stamp,
      createdAt: stamp
    });
    db.prepare(
      `UPDATE cashDrawerEodTills
          SET cashierId = @cashierId,
              countedCashPaise = @countedCashPaise,
              updatedAt = @updatedAt
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: session.branch_id,
      id: tillId,
      cashierId: incomingCashierId,
      countedCashPaise,
      updatedAt: stamp
    });
    return this.summary(session.id, access);
  }

  floatSuggestion(sessionId, access = {}) {
    const session = this.requireSession(sessionId, access);
    const suggestion = this.floatSuggestionForSession(session);
    db.prepare(
      `UPDATE cash_drawer_sessions
          SET nextDayFloatSuggestion = @nextDayFloatSuggestion,
              safeMovePaise = @safeMovePaise
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: session.branch_id,
      id: session.id,
      nextDayFloatSuggestion: JSON.stringify(suggestion),
      safeMovePaise: suggestion.safeMovePaise
    });
    return suggestion;
  }

  threeWayReconciliation(sessionId, access = {}) {
    const session = this.requireSession(sessionId, access);
    this.syncCollections(session, access);
    this.refreshPendingSettlements(session, access);
    const fresh = this.requireSession(sessionId, access);
    const rows = this.computeThreeWayRows(fresh, access);
    const cashierView = isCashier(access);
    const visibleRows = cashierView ? rows.filter((row) => row.status !== "matched") : rows;
    return {
      rows: visibleRows,
      matched: cashierView ? [] : rows.filter((row) => row.status === "matched"),
      exceptions: rows.filter((row) => row.status === "exception"),
      pending: rows.filter((row) => row.status === "pending"),
      depositSlips: this.depositSlips(fresh),
      cashierView
    };
  }

  reconciliationExceptions(sessionId, access = {}) {
    return { exceptions: this.threeWayReconciliation(sessionId, access).exceptions };
  }

  pendingSettlements(query = {}, access = {}) {
    const branchId = getBranchId(query, access);
    const status = query.status || "pending";
    return db.prepare(
      `SELECT *
         FROM cashDrawerEodPendingSettlements
        WHERE tenantId = @tenantId AND branchId = @branchId
          AND (@status = '' OR status = @status)
        ORDER BY expectedCreditDate ASC, createdAt ASC`
    ).all({ tenantId: access.tenantId, branchId, status }).map((row) => ({
      ...row,
      grossPaise: Number(row.grossPaise || 0),
      netPaise: Number(row.netPaise || 0)
    }));
  }

  importSettlementCsv(sessionId, payload = {}, access = {}) {
    const session = this.requireSession(sessionId, access);
    this.assertOpen(session);
    const provider = String(payload.provider || "gateway").trim().toLowerCase();
    const rows = Array.isArray(payload.rows) ? payload.rows : parseCsv(payload.csv || payload.fileContent || payload.content || "");
    if (!rows.length) throw badRequest("CSV rows are required");
    const stamp = now();
    const importId = makeId("setimp");
    const parsedRows = rows.map((row) => this.normalizeSettlementImportRow(row, provider, session));
    const results = parsedRows.map((row) => this.matchSettlementRow(row, session, access));
    const matchedCount = results.filter((row) => row.status === "matched").length;
    const pendingCount = results.filter((row) => row.status === "pending").length;
    const unmatchedCount = results.filter((row) => row.status === "unmatched").length;

    db.prepare(
      `INSERT INTO cashDrawerEodSettlementImports
        (id, tenantId, branchId, sessionId, provider, businessDate, fileName, rowCount, matchedCount,
         unmatchedCount, pendingCount, importedBy, importedAt, createdAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @provider, @businessDate, @fileName, @rowCount, @matchedCount,
         @unmatchedCount, @pendingCount, @importedBy, @importedAt, @createdAt)`
    ).run({
      id: importId,
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      provider,
      businessDate: session.businessDate || istBusinessDate(),
      fileName: payload.fileName || payload.filename || "",
      rowCount: parsedRows.length,
      matchedCount,
      unmatchedCount,
      pendingCount,
      importedBy: access.userId || "",
      importedAt: stamp,
      createdAt: stamp
    });

    const insertRow = db.prepare(
      `INSERT INTO cashDrawerEodSettlementImportRows
        (id, tenantId, branchId, sessionId, importId, provider, mode, paymentRef, bankRef, amountPaise,
         settlementChargePaise, netPaise, paymentDate, creditedDate, status, invoiceId, reason, rawJson, createdAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @importId, @provider, @mode, @paymentRef, @bankRef, @amountPaise,
         @settlementChargePaise, @netPaise, @paymentDate, @creditedDate, @status, @invoiceId, @reason, @rawJson, @createdAt)`
    );
    for (const result of results) {
      insertRow.run({
        id: result.id,
        tenantId: access.tenantId,
        branchId: session.branch_id,
        sessionId: session.id,
        importId,
        provider,
        mode: result.mode,
        paymentRef: result.paymentRef,
        bankRef: result.bankRef,
        amountPaise: result.amountPaise,
        settlementChargePaise: result.settlementChargePaise,
        netPaise: result.netPaise,
        paymentDate: result.paymentDate,
        creditedDate: result.creditedDate,
        status: result.status,
        invoiceId: result.invoiceId,
        reason: result.reason,
        rawJson: JSON.stringify(result.raw),
        createdAt: stamp
      });
      if (result.status === "pending") this.upsertPendingSettlement(session, result, importId, access);
    }
    this.applySettlementImportAggregates(session, results, importId, access);
    return {
      importId,
      rowCount: parsedRows.length,
      matchedCount,
      unmatchedCount,
      pendingCount,
      rows: results,
      reconciliation: this.threeWayReconciliation(session.id, access)
    };
  }

  createDepositSlip(sessionId, payload = {}, access = {}) {
    const session = this.requireSession(sessionId, access);
    const denominations = this.denominations(session);
    const amountPaise = toInteger(payload.amountPaise ?? payload.amount_paise ?? session.countedCashPaise ?? 0);
    if (amountPaise <= 0) throw badRequest("amountPaise must be greater than 0");
    const stamp = now();
    const slipNo = payload.slipNo || payload.slip_no || `DEP-${(session.businessDate || istBusinessDate()).replace(/-/g, "")}-${session.branch_id.slice(-4)}-${Date.now().toString().slice(-4)}`;
    db.prepare(
      `INSERT INTO cashDrawerEodDepositSlips
        (id, tenantId, branchId, sessionId, slipNo, amountPaise, denominationBreakdown, status, bankName,
         depositRef, depositedBy, depositedAt, confirmedBy, confirmedAt, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @slipNo, @amountPaise, @denominationBreakdown, @status, @bankName,
         @depositRef, @depositedBy, @depositedAt, '', '', @createdAt, @updatedAt)`
    ).run({
      id: makeId("depslip"),
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      slipNo,
      amountPaise,
      denominationBreakdown: JSON.stringify(payload.denominations || denominations),
      status: payload.status || "draft",
      bankName: payload.bankName || payload.bank_name || "",
      depositRef: payload.depositRef || payload.deposit_ref || "",
      depositedBy: payload.depositedBy || payload.deposited_by || access.userId || "",
      depositedAt: payload.depositedAt || payload.deposited_at || "",
      createdAt: stamp,
      updatedAt: stamp
    });
    return this.threeWayReconciliation(session.id, access);
  }

  confirmDepositSlip(depositSlipId, payload = {}, access = {}) {
    const slip = db.prepare(
      `SELECT *
         FROM cashDrawerEodDepositSlips
        WHERE tenantId = @tenantId AND id = @id`
    ).get({ tenantId: access.tenantId, id: depositSlipId });
    if (!slip) throw notFound("Deposit slip not found");
    tenantService.assertBranchAccess(access, slip.branchId);
    const stamp = now();
    db.prepare(
      `UPDATE cashDrawerEodDepositSlips
          SET status = @status,
              bankName = COALESCE(NULLIF(@bankName, ''), bankName),
              depositRef = COALESCE(NULLIF(@depositRef, ''), depositRef),
              depositedBy = COALESCE(NULLIF(@depositedBy, ''), depositedBy),
              depositedAt = COALESCE(NULLIF(@depositedAt, ''), depositedAt),
              confirmedBy = @confirmedBy,
              confirmedAt = @confirmedAt,
              updatedAt = @updatedAt
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: slip.branchId,
      id: slip.id,
      status: payload.status || "confirmed",
      bankName: payload.bankName || payload.bank_name || "",
      depositRef: payload.depositRef || payload.deposit_ref || "",
      depositedBy: payload.depositedBy || payload.deposited_by || access.userId || "",
      depositedAt: payload.depositedAt || payload.deposited_at || stamp,
      confirmedBy: access.userId || "",
      confirmedAt: stamp,
      updatedAt: stamp
    });
    return this.threeWayReconciliation(slip.sessionId, access);
  }

  normalizeSettlementImportRow(row = {}, provider, session) {
    const amountPaise = currencyToPaise(rowValue(row, ["amount", "gross", "grossAmount", "paymentAmount", "paidAmount", "settlementAmount"]));
    const netPaise = currencyToPaise(rowValue(row, ["net", "netAmount", "creditedAmount", "bankAmount"]));
    const settlementChargePaise = currencyToPaise(rowValue(row, ["fee", "fees", "charge", "mdr", "settlementCharge", "commission"]));
    const mode = normalizeMode(rowValue(row, ["mode", "paymentMode", "method", "paymentMethod", "gateway"]) || provider);
    const paymentDate = String(rowValue(row, ["paymentDate", "paidAt", "date", "transactionDate"]) || session.businessDate || istBusinessDate()).slice(0, 10);
    const creditedDate = String(rowValue(row, ["creditedDate", "settledAt", "settlementDate", "creditDate"]) || "").slice(0, 10);
    return {
      mode,
      paymentRef: String(rowValue(row, ["paymentRef", "reference", "referenceNo", "utr", "rrn", "providerPaymentId", "paymentId", "transactionId"]) || "").trim(),
      bankRef: String(rowValue(row, ["bankRef", "utr", "settlementId", "batchId"]) || "").trim(),
      amountPaise,
      settlementChargePaise,
      netPaise: netPaise || Math.max(0, amountPaise - settlementChargePaise),
      paymentDate,
      creditedDate,
      raw: row
    };
  }

  matchSettlementRow(row, session, access = {}) {
    const candidates = this.invoicePaymentCandidates(session, row.paymentDate, access)
      .filter((candidate) => normalizeMode(candidate.payment_mode) === row.mode)
      .filter((candidate) => rupeesToPaise(candidate.amount) === row.amountPaise);
    const ref = row.paymentRef.toLowerCase();
    const exact = ref
      ? candidates.find((candidate) => [
        candidate.reference_no,
        candidate.provider_payment_id,
        candidate.provider_order_id,
        candidate.provider_link_id,
        candidate.invoice_id
      ].some((value) => String(value || "").toLowerCase() === ref))
      : null;
    const matched = exact || (candidates.length === 1 ? candidates[0] : null);
    const creditedDate = row.creditedDate || "";
    const status = matched ? (creditedDate ? "matched" : "pending") : "unmatched";
    return {
      ...row,
      id: makeId("setrow"),
      status,
      invoiceId: matched?.invoice_id || "",
      reason: matched ? (creditedDate ? "matched by amount/ref/date" : "awaiting bank credit date") : "no matching paid invoice",
      creditedDate
    };
  }

  invoicePaymentCandidates(session, paymentDate, access = {}) {
    if (!hasTable("invoice_payments") || !hasTable("invoices")) return [];
    return db.prepare(
      `SELECT ip.*, i.branch_id
         FROM invoice_payments ip
         JOIN invoices i ON i.tenant_id = ip.tenant_id AND i.id = ip.invoice_id
        WHERE ip.tenant_id = @tenantId
          AND i.branch_id = @branchId
          AND ip.status = 'paid'
          AND date(COALESCE(NULLIF(ip.paid_at, ''), ip.created_at)) = date(@paymentDate)`
    ).all({
      tenantId: access.tenantId,
      branchId: session.branch_id,
      paymentDate: paymentDate || session.businessDate || istBusinessDate()
    });
  }

  applySettlementImportAggregates(session, rows, importId, access = {}) {
    const byMode = new Map();
    for (const row of rows.filter((item) => item.status !== "unmatched")) {
      const bucket = byMode.get(row.mode) || { grossPaise: 0, chargePaise: 0, netPaise: 0, invoiceIds: [], pending: false };
      bucket.grossPaise += Number(row.amountPaise || 0);
      bucket.chargePaise += Number(row.settlementChargePaise || 0);
      bucket.netPaise += Number(row.netPaise || 0);
      if (row.invoiceId) bucket.invoiceIds.push(row.invoiceId);
      if (row.status === "pending") bucket.pending = true;
      byMode.set(row.mode, bucket);
    }
    const stamp = now();
    const upsert = db.prepare(
      `INSERT INTO cashDrawerEodSettlements
        (id, tenantId, branchId, sessionId, mode, grossPaise, settlementChargePaise, netPaise, bankRef,
         reconciled, updatedBy, createdAt, updatedAt, settlementStatus, creditedAt, importBatchId, matchedInvoiceIds)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @mode, @grossPaise, @settlementChargePaise, @netPaise, @bankRef,
         @reconciled, @updatedBy, @createdAt, @updatedAt, @settlementStatus, @creditedAt, @importBatchId, @matchedInvoiceIds)
       ON CONFLICT(tenantId, branchId, sessionId, mode)
       DO UPDATE SET
         grossPaise = excluded.grossPaise,
         settlementChargePaise = excluded.settlementChargePaise,
         netPaise = excluded.netPaise,
         bankRef = excluded.bankRef,
         reconciled = excluded.reconciled,
         updatedBy = excluded.updatedBy,
         updatedAt = excluded.updatedAt,
         settlementStatus = excluded.settlementStatus,
         creditedAt = excluded.creditedAt,
         importBatchId = excluded.importBatchId,
         matchedInvoiceIds = excluded.matchedInvoiceIds`
    );
    for (const [mode, bucket] of byMode.entries()) {
      upsert.run({
        id: makeId("eodset"),
        tenantId: access.tenantId,
        branchId: session.branch_id,
        sessionId: session.id,
        mode,
        grossPaise: bucket.grossPaise,
        settlementChargePaise: bucket.chargePaise,
        netPaise: bucket.netPaise,
        bankRef: importId,
        reconciled: bucket.pending ? 0 : 1,
        updatedBy: access.userId || "",
        createdAt: stamp,
        updatedAt: stamp,
        settlementStatus: bucket.pending ? "pending" : "matched",
        creditedAt: bucket.pending ? "" : stamp,
        importBatchId: importId,
        matchedInvoiceIds: JSON.stringify([...new Set(bucket.invoiceIds)])
      });
    }
    this.computeThreeWayRows(session, access);
  }

  upsertPendingSettlement(session, row, importId, access = {}) {
    const expectedCreditDate = row.creditedDate || plusDays(row.paymentDate || session.businessDate, 1);
    db.prepare(
      `INSERT INTO cashDrawerEodPendingSettlements
        (id, tenantId, branchId, sessionId, mode, grossPaise, netPaise, paymentRef, expectedCreditDate,
         creditedAt, status, settlementId, importRowId, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @mode, @grossPaise, @netPaise, @paymentRef, @expectedCreditDate,
         '', 'pending', '', @importRowId, @createdAt, @updatedAt)
       ON CONFLICT(tenantId, branchId, sessionId, mode, paymentRef)
       DO UPDATE SET
         grossPaise = excluded.grossPaise,
         netPaise = excluded.netPaise,
         expectedCreditDate = excluded.expectedCreditDate,
         importRowId = excluded.importRowId,
         updatedAt = excluded.updatedAt`
    ).run({
      id: makeId("pending"),
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      mode: row.mode,
      grossPaise: row.amountPaise,
      netPaise: row.netPaise,
      paymentRef: row.paymentRef || `${importId}:${row.id}`,
      expectedCreditDate,
      importRowId: row.id,
      createdAt: now(),
      updatedAt: now()
    });
  }

  refreshPendingSettlements(session, access = {}) {
    const settlements = this.settlements(session);
    const stamp = now();
    for (const settlement of settlements.filter((row) => NON_CASH_MODES.has(row.mode) && Number(row.grossPaise || 0) > 0 && Number(row.reconciled || 0) === 0)) {
      db.prepare(
        `INSERT INTO cashDrawerEodPendingSettlements
          (id, tenantId, branchId, sessionId, mode, grossPaise, netPaise, paymentRef, expectedCreditDate,
           creditedAt, status, settlementId, importRowId, createdAt, updatedAt)
         VALUES
          (@id, @tenantId, @branchId, @sessionId, @mode, @grossPaise, @netPaise, @paymentRef, @expectedCreditDate,
           '', 'pending', @settlementId, '', @createdAt, @updatedAt)
         ON CONFLICT(tenantId, branchId, sessionId, mode, paymentRef)
         DO UPDATE SET
           grossPaise = excluded.grossPaise,
           netPaise = excluded.netPaise,
           settlementId = excluded.settlementId,
           updatedAt = excluded.updatedAt`
      ).run({
        id: makeId("pending"),
        tenantId: access.tenantId,
        branchId: session.branch_id,
        sessionId: session.id,
        mode: settlement.mode,
        grossPaise: Number(settlement.grossPaise || 0),
        netPaise: Number(settlement.netPaise || 0),
        paymentRef: settlement.bankRef || settlement.mode,
        expectedCreditDate: plusDays(session.businessDate || istBusinessDate(), 1),
        settlementId: settlement.id,
        createdAt: stamp,
        updatedAt: stamp
      });
    }
  }

  computeThreeWayRows(session, access = {}) {
    const collections = this.collections(session);
    const settlements = this.settlements(session);
    const depositSlips = this.depositSlips(session);
    const latestCashDeposit = depositSlips.find((slip) => slip.status === "confirmed") || depositSlips[0] || null;
    const physicalCashFromCountPaise = Math.max(0, Number(session.countedCashPaise || 0) - Number(session.openingBalancePaise || 0) + Number(session.cashPayoutPaise || 0) - Number(session.cashOperationImpactPaise || 0));
    const stamp = now();
    const rows = [];
    const upsert = db.prepare(
      `INSERT INTO cashDrawerEodThreeWayMatches
        (id, tenantId, branchId, sessionId, mode, posCollectionPaise, settlementGrossPaise, physicalCashPaise,
         posSettlementDeltaPaise, posPhysicalDeltaPaise, status, exceptionReason, computedAt, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @mode, @posCollectionPaise, @settlementGrossPaise, @physicalCashPaise,
         @posSettlementDeltaPaise, @posPhysicalDeltaPaise, @status, @exceptionReason, @computedAt, @createdAt, @updatedAt)
       ON CONFLICT(tenantId, branchId, sessionId, mode)
       DO UPDATE SET
         posCollectionPaise = excluded.posCollectionPaise,
         settlementGrossPaise = excluded.settlementGrossPaise,
         physicalCashPaise = excluded.physicalCashPaise,
         posSettlementDeltaPaise = excluded.posSettlementDeltaPaise,
         posPhysicalDeltaPaise = excluded.posPhysicalDeltaPaise,
         status = excluded.status,
         exceptionReason = excluded.exceptionReason,
         computedAt = excluded.computedAt,
         updatedAt = excluded.updatedAt`
    );
    for (const collection of collections.filter((row) => Number(row.finalAmountPaise || 0) > 0 || row.mode === "cash")) {
      const mode = collection.mode;
      const settlement = settlements.find((row) => row.mode === mode);
      const posCollectionPaise = Number(collection.finalAmountPaise || 0);
      const settlementGrossPaise = mode === "cash" ? Number(latestCashDeposit?.amountPaise ?? physicalCashFromCountPaise) : Number(settlement?.grossPaise || 0);
      const physicalCashPaise = mode === "cash" ? physicalCashFromCountPaise : 0;
      const posSettlementDeltaPaise = posCollectionPaise - settlementGrossPaise;
      const posPhysicalDeltaPaise = mode === "cash" ? posCollectionPaise - physicalCashPaise : 0;
      const pending = mode !== "cash" && (!settlement || Number(settlement.reconciled || 0) === 0 || settlement.settlementStatus === "pending");
      const cashDepositPending = mode === "cash" && latestCashDeposit?.status === "draft";
      const exception = posSettlementDeltaPaise !== 0 || posPhysicalDeltaPaise !== 0;
      const status = pending || cashDepositPending ? "pending" : exception ? "exception" : "matched";
      const exceptionReason = this.threeWayReason({ mode, pending, cashDepositPending, posSettlementDeltaPaise, posPhysicalDeltaPaise });
      const row = {
        id: makeId("threematch"),
        tenantId: access.tenantId,
        branchId: session.branch_id,
        sessionId: session.id,
        mode,
        posCollectionPaise,
        settlementGrossPaise,
        physicalCashPaise,
        posSettlementDeltaPaise,
        posPhysicalDeltaPaise,
        status,
        exceptionReason,
        computedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp
      };
      upsert.run(row);
      rows.push(row);
    }
    return rows;
  }

  threeWayReason({ mode, pending, cashDepositPending, posSettlementDeltaPaise, posPhysicalDeltaPaise }) {
    if (pending) return "Bank settlement pending";
    if (cashDepositPending) return "Cash deposit slip pending confirmation";
    if (mode === "cash" && posPhysicalDeltaPaise !== 0) return "Physical cash does not match POS cash collection";
    if (posSettlementDeltaPaise !== 0) return "POS collection does not match settlement/deposit amount";
    return "";
  }

  depositSlips(session) {
    return db.prepare(
      `SELECT *
         FROM cashDrawerEodDepositSlips
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
        ORDER BY createdAt DESC`
    ).all({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id }).map((row) => ({
      ...row,
      amountPaise: Number(row.amountPaise || 0),
      denominationBreakdown: parseJson(row.denominationBreakdown, [])
    }));
  }

  setDenominations(sessionId, payload = {}, access = {}) {
    const session = this.requireSession(sessionId, access);
    this.assertOpen(session);
    const rows = Array.isArray(payload.denominations) ? payload.denominations : [];
    if (!rows.length) throw badRequest("denominations are required");
    const stamp = now();
    let countedCashPaise = 0;
    const insertRows = rows.map((row) => {
      const denominationPaise = toInteger(row.denominationPaise ?? row.denomination_paise);
      const kind = row.kind || defaultDenominationKind(denominationPaise);
      if (!allowedDenomination(denominationPaise, kind)) throw badRequest("Unsupported denomination", { denominationPaise, kind });
      const qty = Math.max(0, toInteger(row.qty));
      const subtotalPaise = denominationPaise * qty;
      countedCashPaise += subtotalPaise;
      return {
        id: makeId("denom"),
        tenantId: access.tenantId,
        branchId: session.branch_id,
        sessionId: session.id,
        denominationPaise,
        kind,
        qty,
        subtotalPaise,
        createdAt: stamp,
        updatedAt: stamp
      };
    });

    const replace = db.transaction(() => {
      db.prepare(
        `DELETE FROM cashDrawerEodDenominations
          WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
      ).run({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
      const insert = db.prepare(
        `INSERT INTO cashDrawerEodDenominations
          (id, tenantId, branchId, sessionId, denominationPaise, kind, qty, subtotalPaise, createdAt, updatedAt)
         VALUES
          (@id, @tenantId, @branchId, @sessionId, @denominationPaise, @kind, @qty, @subtotalPaise, @createdAt, @updatedAt)`
      );
      for (const row of insertRows) insert.run(row);
      db.prepare(
        `UPDATE cash_drawer_sessions
            SET countedCashPaise = @countedCashPaise
          WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
      ).run({ tenantId: access.tenantId, branchId: session.branch_id, id: session.id, countedCashPaise });
    });
    replace();
    this.recalculateSession(session.id, access);
    return this.summary(session.id, access);
  }

  upsertSettlement(sessionId, payload = {}, access = {}) {
    const session = this.requireSession(sessionId, access);
    this.assertOpen(session);
    return this.saveSettlement(session, payload, access);
  }

  patchSettlement(settlementId, payload = {}, access = {}) {
    ensureCashDrawerEodSchema();
    const existing = db.prepare(
      `SELECT *
         FROM cashDrawerEodSettlements
        WHERE tenantId = @tenantId AND id = @id`
    ).get({ tenantId: access.tenantId, id: settlementId });
    if (!existing) throw notFound("Settlement row not found");
    const session = this.requireSession(existing.sessionId, access);
    this.assertOpen(session);
    return this.saveSettlement(session, { ...existing, ...payload, mode: existing.mode }, access);
  }

  summary(sessionId, access = {}) {
    ensureCashDrawerEodSchema();
    const session = this.requireSession(sessionId, access);
    this.syncCollections(session, access);
    const fresh = this.requireSession(sessionId, access);
    return this.serialize(fresh, access);
  }

  canClose(sessionId, access = {}) {
    ensureCashDrawerEodSchema();
    const session = this.requireSession(sessionId, access);
    this.syncCollections(session, access);
    const fresh = this.requireSession(sessionId, access);
    const risk = this.riskSnapshot(fresh, access, { persist: true });
    const blockers = this.closeBlockers(fresh, access, { risk });
    return { canClose: blockers.length === 0, blockers, risk };
  }

  riskSummary(sessionId, access = {}) {
    ensureCashDrawerEodSchema();
    const session = this.requireSession(sessionId, access);
    this.syncCollections(session, access);
    return this.riskSnapshot(this.requireSession(sessionId, access), access, { persist: true });
  }

  ownerRiskDashboard(query = {}, access = {}) {
    ensureCashDrawerEodSchema();
    const branchId = getBranchId(query, access);
    const dateTo = String(query.dateTo || query.to || query.businessDate || query.date || istBusinessDate()).slice(0, 10);
    const dateFrom = String(query.dateFrom || query.from || plusDays(dateTo, -7)).slice(0, 10);
    const limit = Math.min(100, Math.max(1, toInteger(query.limit || 40)));
    const sessions = db.prepare(
      `SELECT *
         FROM cash_drawer_sessions
        WHERE tenant_id = @tenantId
          AND branch_id = @branchId
          AND date(COALESCE(NULLIF(businessDate, ''), opened_at)) BETWEEN date(@dateFrom) AND date(@dateTo)
          AND (
            status = 'open'
            OR COALESCE(riskScore, 0) >= 25
            OR COALESCE(approvalStatus, '') IN ('required', 'pending', 'rejected')
          )
        ORDER BY
          CASE COALESCE(approvalStatus, '')
            WHEN 'pending' THEN 0
            WHEN 'required' THEN 1
            WHEN 'rejected' THEN 2
            ELSE 3
          END,
          COALESCE(riskScore, 0) DESC,
          opened_at DESC
        LIMIT @limit`
    ).all({ tenantId: access.tenantId, branchId, dateFrom, dateTo, limit });

    const rows = sessions.map((row) => {
      if (row.status !== "closed") this.syncCollections(row, access);
      const fresh = this.requireSession(row.id, access);
      const risk = this.riskSnapshot(fresh, access, { persist: true });
      const blockers = this.closeBlockers(fresh, access, { risk });
      const reconciliation = this.threeWayReconciliation(fresh.id, access);
      const approval = risk.approval || null;
      return {
        sessionId: fresh.id,
        businessDate: fresh.businessDate || "",
        status: fresh.status,
        openedBy: fresh.openedBy || fresh.cashier_id || "",
        openedAt: fresh.opened_at || "",
        expectedCashPaise: Number(fresh.expectedCashPaise || 0),
        countedCashPaise: Number(fresh.countedCashPaise || 0),
        variancePaise: Number(fresh.variancePaise || 0),
        riskScore: risk.score,
        riskLevel: risk.level,
        approvalStatus: risk.approvalStatus,
        approval,
        approvalLink: approval?.approvalLink || "",
        whatsappDeepLink: approval?.whatsappDeepLink || "",
        whatsappMessage: approval?.whatsappMessage || "",
        blockers,
        settlementMatched: reconciliation.matched.length,
        settlementPending: reconciliation.pending.length,
        settlementExceptions: reconciliation.exceptions.length,
        topEvents: risk.events.slice(0, 3),
        canClose: blockers.length === 0
      };
    });

    return {
      branchId,
      dateFrom,
      dateTo,
      asOf: now(),
      summary: {
        total: rows.length,
        pendingApproval: rows.filter((row) => row.approvalStatus === "pending").length,
        approvalRequired: rows.filter((row) => row.approvalStatus === "required").length,
        highRisk: rows.filter((row) => row.riskScore >= 50).length,
        openSessions: rows.filter((row) => row.status === "open").length,
        variancePaise: rows.reduce((sum, row) => sum + Math.abs(Number(row.variancePaise || 0)), 0),
        settlementPending: rows.reduce((sum, row) => sum + Number(row.settlementPending || 0), 0),
        settlementExceptions: rows.reduce((sum, row) => sum + Number(row.settlementExceptions || 0), 0)
      },
      rows
    };
  }

  riskApprovalByToken(token = "") {
    ensureCashDrawerEodSchema();
    const approval = this.approvalByToken(token);
    const access = this.publicApprovalAccess(approval);
    const session = this.requireSession(approval.sessionId, access);
    const risk = this.riskSnapshot(session, access, { persist: false });
    const expired = Boolean(approval.approvalTokenExpiresAt && approval.approvalTokenExpiresAt < now());
    return {
      tokenStatus: expired && approval.status === "pending" ? "expired" : approval.status,
      expired,
      request: this.approvalToApi(approval),
      session: {
        id: session.id,
        businessDate: session.businessDate || istBusinessDate(),
        branchId: session.branch_id,
        status: session.status,
        openedBy: session.openedBy || session.cashier_id || "",
        expectedCashPaise: Number(session.expectedCashPaise || 0),
        countedCashPaise: Number(session.countedCashPaise || 0),
        variancePaise: Number(session.variancePaise || 0)
      },
      risk: {
        score: risk.score,
        level: risk.level,
        approvalStatus: risk.approvalStatus,
        events: risk.events.slice(0, 5)
      }
    };
  }

  reviewRiskApprovalByToken(token = "", payload = {}) {
    ensureCashDrawerEodSchema();
    const approval = this.approvalByToken(token);
    if (approval.approvalTokenExpiresAt && approval.approvalTokenExpiresAt < now()) throw badRequest("Approval link has expired");
    if (approval.status !== "pending") return this.riskApprovalByToken(token);
    const decision = payload.approved === true || payload.status === "approved" || payload.decision === "approved" ? "approved" : "rejected";
    const reviewNote = String(payload.reviewNote || payload.note || "").trim();
    if (decision === "rejected" && !reviewNote) throw badRequest("Review note is required when rejecting approval");
    const access = this.publicApprovalAccess(approval);
    this.reviewRiskApproval(approval.id, {
      decision,
      reviewNote: reviewNote || "Approved from WhatsApp approval link",
      varianceReason: payload.varianceReason || approval.reason || reviewNote
    }, access);
    return this.riskApprovalByToken(token);
  }

  requestRiskApproval(sessionId, payload = {}, access = {}) {
    ensureCashDrawerEodSchema();
    const session = this.requireSession(sessionId, access);
    this.assertOpen(session);
    this.syncCollections(session, access);
    const fresh = this.requireSession(sessionId, access);
    const risk = this.riskSnapshot(fresh, access, { persist: true });
    if (!risk.approvalNeeded) throw badRequest("Risk approval is not required for this session");
    const reason = String(payload.reason || payload.approvalReason || payload.varianceReason || "").trim();
    if (!reason) throw badRequest("Approval reason is required");
    const existing = this.latestApprovalForSession(fresh, access, "pending");
    const requestId = existing?.id || makeId("riskappr");
    const stamp = now();
    const blockers = this.closeBlockers(fresh, access, { skipRisk: true, varianceReason: reason });
    const approvalToken = existing?.approvalToken || randomUUID().replace(/-/g, "");
    const approvalTokenExpiresAt = existing?.approvalTokenExpiresAt || plusHoursIso(24);
    const approvalLink = this.approvalLink(fresh, requestId, approvalToken);
    const recipient = this.ownerApprovalRecipient(fresh.branch_id, access);
    const whatsappMessage = this.approvalWhatsappMessage(fresh, risk, {
      id: requestId,
      reason,
      approvalLink
    });
    const deepLink = whatsappDeepLink(recipient, whatsappMessage);
    db.prepare(
      `INSERT INTO cashDrawerEodApprovalRequests
        (id, tenantId, branchId, sessionId, businessDate, approvalType, status, reason, requestedBy, requestedAt,
         reviewedBy, reviewedAt, reviewNote, riskScore, blockers, metadata, approvalToken, approvalTokenExpiresAt,
         approvalLink, whatsappMessageId, whatsappMessage, whatsappDeepLink, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @businessDate, 'cashRiskClose', 'pending', @reason, @requestedBy, @requestedAt,
         '', '', '', @riskScore, @blockers, @metadata, @approvalToken, @approvalTokenExpiresAt,
         @approvalLink, '', @whatsappMessage, @whatsappDeepLink, @createdAt, @updatedAt)
       ON CONFLICT(id)
       DO UPDATE SET
         reason = excluded.reason,
         riskScore = excluded.riskScore,
         blockers = excluded.blockers,
         metadata = excluded.metadata,
         approvalToken = excluded.approvalToken,
         approvalTokenExpiresAt = excluded.approvalTokenExpiresAt,
         approvalLink = excluded.approvalLink,
         whatsappMessage = excluded.whatsappMessage,
         whatsappDeepLink = excluded.whatsappDeepLink,
         requestedAt = excluded.requestedAt,
         updatedAt = excluded.updatedAt`
    ).run({
      id: requestId,
      tenantId: access.tenantId,
      branchId: fresh.branch_id,
      sessionId: fresh.id,
      businessDate: fresh.businessDate || istBusinessDate(),
      reason,
      requestedBy: access.userId || "",
      requestedAt: stamp,
      riskScore: risk.score,
      blockers: JSON.stringify(blockers),
      metadata: JSON.stringify({ level: risk.level, events: risk.events.map((event) => event.code) }),
      approvalToken,
      approvalTokenExpiresAt,
      approvalLink,
      whatsappMessage,
      whatsappDeepLink: deepLink,
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp
    });
    const whatsappMessageId = this.queueApprovalWhatsapp(fresh, {
      requestId,
      recipient,
      whatsappMessage,
      approvalLink,
      deepLink
    }, access);
    if (whatsappMessageId) {
      db.prepare(
        `UPDATE cashDrawerEodApprovalRequests
            SET whatsappMessageId = @whatsappMessageId,
                updatedAt = @updatedAt
          WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
      ).run({
        tenantId: access.tenantId,
        branchId: fresh.branch_id,
        id: requestId,
        whatsappMessageId,
        updatedAt: stamp
      });
    }
    db.prepare(
      `UPDATE cash_drawer_sessions
          SET approvalStatus = 'pending',
              approvalRequestId = @approvalRequestId
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
    ).run({ tenantId: access.tenantId, branchId: fresh.branch_id, id: fresh.id, approvalRequestId: requestId });
    return this.riskSnapshot(this.requireSession(sessionId, access), access, { persist: true });
  }

  reviewRiskApproval(requestId, payload = {}, access = {}) {
    ensureCashDrawerEodSchema();
    if (!canOverride(access)) throw badRequest("Manager or owner approval is required");
    const request = db.prepare(
      `SELECT *
         FROM cashDrawerEodApprovalRequests
        WHERE tenantId = @tenantId AND id = @id`
    ).get({ tenantId: access.tenantId, id: requestId });
    if (!request) throw notFound("Cash risk approval request not found");
    tenantService.assertBranchAccess(access, request.branchId);
    if (request.status !== "pending") return this.riskSummary(request.sessionId, access);
    const decision = payload.approved === true || payload.status === "approved" || payload.decision === "approved" ? "approved" : "rejected";
    const reviewNote = String(payload.reviewNote || payload.note || "").trim();
    if (decision === "rejected" && !reviewNote) throw badRequest("Review note is required when rejecting approval");
    const stamp = now();
    db.prepare(
      `UPDATE cashDrawerEodApprovalRequests
          SET status = @status,
              reviewedBy = @reviewedBy,
              reviewedAt = @reviewedAt,
              reviewNote = @reviewNote,
              updatedAt = @updatedAt
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: request.branchId,
      id: request.id,
      status: decision,
      reviewedBy: access.userId || "",
      reviewedAt: stamp,
      reviewNote,
      updatedAt: stamp
    });
    const varianceReason = String(payload.varianceReason || reviewNote || request.reason || "").trim();
    db.prepare(
      `UPDATE cash_drawer_sessions
          SET approvalStatus = @approvalStatus,
              approvalRequestId = @approvalRequestId,
              varianceReason = CASE WHEN @approvalStatus = 'approved' THEN @varianceReason ELSE varianceReason END,
              overrideBy = CASE WHEN @approvalStatus = 'approved' THEN @overrideBy ELSE overrideBy END,
              overrideAt = CASE WHEN @approvalStatus = 'approved' THEN @overrideAt ELSE overrideAt END
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: request.branchId,
      id: request.sessionId,
      approvalStatus: decision,
      approvalRequestId: request.id,
      varianceReason,
      overrideBy: access.userId || "",
      overrideAt: stamp
    });
    return this.riskSummary(request.sessionId, access);
  }

  close(sessionId, payload = {}, access = {}) {
    const session = this.requireSession(sessionId, access);
    this.assertOpen(session);
    this.syncCollections(session, access);
    const fresh = this.requireSession(sessionId, access);
    const risk = this.riskSnapshot(fresh, access, { persist: true });
    const varianceReason = String(payload.varianceReason || payload.reason || risk.approval?.reason || risk.approval?.reviewNote || fresh.varianceReason || "").trim();
    const blockers = this.closeBlockers(fresh, access, { varianceReason, risk });
    if (blockers.length) throw badRequest("Cash drawer EOD cannot close yet", { blockers });
    const closedAt = now();

    db.prepare(
      `UPDATE cash_drawer_sessions
          SET status = 'closed',
              closed_at = @closedAt,
              closedBy = @closedBy,
              varianceReason = @varianceReason,
              overrideBy = @overrideBy,
              overrideAt = @overrideAt,
              riskScore = @riskScore,
              riskLevel = @riskLevel,
              riskEvaluatedAt = @riskEvaluatedAt,
              approvalStatus = @approvalStatus,
              approvalRequestId = @approvalRequestId,
              closing_cash = @closingCash,
              expected_cash = @expectedCash,
              cash_difference = @cashDifference
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: fresh.branch_id,
      id: fresh.id,
      closedAt,
      closedBy: access.userId || "",
      varianceReason,
      overrideBy: Number(fresh.variancePaise || 0) !== 0 ? (risk.approval?.reviewedBy || access.userId || "") : "",
      overrideAt: Number(fresh.variancePaise || 0) !== 0 ? (risk.approval?.reviewedAt || closedAt) : "",
      riskScore: risk.score,
      riskLevel: risk.level,
      riskEvaluatedAt: risk.evaluatedAt,
      approvalStatus: risk.approvalStatus,
      approvalRequestId: risk.approval?.id || fresh.approvalRequestId || "",
      closingCash: paiseToRupees(fresh.countedCashPaise),
      expectedCash: paiseToRupees(fresh.expectedCashPaise),
      cashDifference: paiseToRupees(fresh.variancePaise)
    });

    const closed = this.requireSession(sessionId, access);
    const report = this.freezeReport(closed, access);
    const accounting = this.postAccounting(closed.id, { auto: true }, access);
    return { ...this.serialize(closed, access), report: this.reportForSession(closed, access) || report, accounting, logout: true };
  }

  riskSnapshot(session, access = {}, options = {}) {
    const stamp = now();
    const events = this.evaluateRiskEvents(session, access);
    const score = Math.min(100, events.reduce((sum, event) => sum + Number(event.scoreImpact || 0), 0));
    const level = riskLevel(score);
    const approval = this.latestApprovalForSession(session, access);
    const approvalNeeded = score >= 25 || events.some((event) => event.code === "CASH_VARIANCE" || event.code === "REPEATED_VARIANCE");
    const approvalStatus = approval?.status || (approvalNeeded ? "required" : "not_required");
    const cashierTrend = this.cashierVarianceTrend(session, access);
    const snapshot = {
      score,
      level,
      evaluatedAt: stamp,
      approvalNeeded,
      approvalRequired: approvalNeeded && approvalStatus !== "approved",
      approvalStatus,
      canApprove: canOverride(access),
      approval: this.approvalToApi(approval),
      cashierTrend,
      events: events.map((event) => ({
        ...event,
        sessionId: session.id,
        businessDate: session.businessDate || istBusinessDate(),
        cashierId: session.openedBy || session.cashier_id || "",
        createdAt: stamp
      }))
    };
    if (options.persist) this.persistRiskSnapshot(session, snapshot, access);
    return snapshot;
  }

  evaluateRiskEvents(session, access = {}) {
    const events = [];
    const push = (code, severity, scoreImpact, title, detail) => {
      events.push({ code, severity, scoreImpact, title, detail });
    };
    const variancePaise = Number(session.variancePaise || 0);
    const absVariancePaise = Math.abs(variancePaise);
    if (absVariancePaise > 0) {
      const impact = absVariancePaise >= 200000 ? 45 : absVariancePaise >= 50000 ? 35 : absVariancePaise >= 10000 ? 25 : 15;
      push("CASH_VARIANCE", impact >= 35 ? "high" : impact >= 25 ? "medium" : "low", impact, "Cash variance found", `${paiseToRupees(absVariancePaise).toFixed(2)} variance needs approval trail`);
    }

    const pendingSettlement = db.prepare(
      `SELECT COUNT(*) AS total
         FROM cashDrawerEodSettlements
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
          AND grossPaise > 0 AND reconciled = 0`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    if (Number(pendingSettlement?.total || 0)) {
      push("SETTLEMENT_PENDING", "medium", 20, "Bank settlement pending", `${pendingSettlement.total} payment mode settlement row(s) still pending`);
    }

    const openTills = db.prepare(
      `SELECT COUNT(*) AS total
         FROM cashDrawerEodTills
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
          AND status <> 'closed'`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    if (Number(openTills?.total || 0)) {
      push("TILL_OPEN", "medium", 20, "Till reconciliation pending", `${openTills.total} till(s) are still open`);
    }

    const manualAdjustments = db.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(ABS(manualAdjustmentPaise)), 0) AS amountPaise
         FROM cashDrawerEodCollections
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
          AND manualAdjustmentPaise <> 0`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    if (Number(manualAdjustments?.total || 0)) {
      const impact = Number(manualAdjustments.amountPaise || 0) >= 50000 ? 20 : 12;
      push("MANUAL_COLLECTION_EDIT", impact >= 20 ? "medium" : "low", impact, "Manual collection edit", `${manualAdjustments.total} payment mode amount(s) were manually edited`);
    }

    const operations = this.operationTotals(session);
    const operationVolumePaise = Number(operations.drop || 0) + Number(operations.pickup || 0) + Number(operations.payout || 0);
    if (operationVolumePaise >= 100000) {
      const impact = operationVolumePaise >= 500000 ? 25 : 12;
      push("HIGH_CASH_MOVEMENT", impact >= 25 ? "medium" : "low", impact, "High cash movement", `Drops/pickups/payouts total ${paiseToRupees(operationVolumePaise).toFixed(2)}`);
    }

    const trend = this.cashierVarianceTrend(session, access);
    if (Number(trend.varianceSessions || 0) >= 3) {
      push("REPEATED_VARIANCE", "high", 25, "Cashier variance trend", `${trend.varianceSessions} variance day(s) in last 30 business days`);
    }
    return events;
  }

  cashierVarianceTrend(session, access = {}) {
    const cashierId = session.openedBy || session.cashier_id || "";
    if (!cashierId) return { cashierId: "", varianceSessions: 0, variancePaise: 0, maxVariancePaise: 0 };
    const row = db.prepare(
      `SELECT COUNT(*) AS varianceSessions,
              COALESCE(SUM(ABS(variancePaise)), 0) AS variancePaise,
              COALESCE(MAX(ABS(variancePaise)), 0) AS maxVariancePaise
         FROM cash_drawer_sessions
        WHERE tenant_id = @tenantId
          AND branch_id = @branchId
          AND id <> @sessionId
          AND COALESCE(openedBy, cashier_id, '') = @cashierId
          AND variancePaise <> 0
          AND date(COALESCE(NULLIF(businessDate, ''), opened_at)) >= date(@sinceDate)`
    ).get({
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      cashierId,
      sinceDate: plusDays(session.businessDate || istBusinessDate(), -30)
    });
    return {
      cashierId,
      varianceSessions: Number(row?.varianceSessions || 0),
      variancePaise: Number(row?.variancePaise || 0),
      maxVariancePaise: Number(row?.maxVariancePaise || 0)
    };
  }

  persistRiskSnapshot(session, snapshot, access = {}) {
    db.prepare(
      `DELETE FROM cashDrawerEodRiskEvents
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).run({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    const insert = db.prepare(
      `INSERT INTO cashDrawerEodRiskEvents
        (id, tenantId, branchId, sessionId, businessDate, cashierId, code, severity, scoreImpact, title, detail, status, createdAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @businessDate, @cashierId, @code, @severity, @scoreImpact, @title, @detail, 'open', @createdAt)`
    );
    for (const event of snapshot.events) {
      insert.run({
        id: makeId("riskevt"),
        tenantId: access.tenantId,
        branchId: session.branch_id,
        sessionId: session.id,
        businessDate: event.businessDate,
        cashierId: event.cashierId,
        code: event.code,
        severity: event.severity,
        scoreImpact: Number(event.scoreImpact || 0),
        title: event.title,
        detail: event.detail || "",
        createdAt: event.createdAt
      });
    }
    db.prepare(
      `UPDATE cash_drawer_sessions
          SET riskScore = @riskScore,
              riskLevel = @riskLevel,
              riskEvaluatedAt = @riskEvaluatedAt,
              approvalStatus = @approvalStatus,
              approvalRequestId = @approvalRequestId
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: session.branch_id,
      id: session.id,
      riskScore: snapshot.score,
      riskLevel: snapshot.level,
      riskEvaluatedAt: snapshot.evaluatedAt,
      approvalStatus: snapshot.approvalStatus,
      approvalRequestId: snapshot.approval?.id || session.approvalRequestId || ""
    });
  }

  latestApprovalForSession(session, access = {}, status = "") {
    return db.prepare(
      `SELECT *
         FROM cashDrawerEodApprovalRequests
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
          AND (@status = '' OR status = @status)
        ORDER BY requestedAt DESC, createdAt DESC
        LIMIT 1`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id, status }) || null;
  }

  approvalByToken(token = "") {
    const cleanToken = String(token || "").trim();
    if (!cleanToken) throw badRequest("Approval token is required");
    const approval = db.prepare(
      `SELECT *
         FROM cashDrawerEodApprovalRequests
        WHERE approvalToken = @approvalToken
        LIMIT 1`
    ).get({ approvalToken: cleanToken });
    if (!approval) throw notFound("Cash risk approval link not found");
    return approval;
  }

  publicApprovalAccess(approval) {
    return {
      tenantId: approval.tenantId,
      branchId: approval.branchId,
      requestedBranchId: approval.branchId,
      branchIds: [approval.branchId],
      role: "owner",
      userId: "owner-whatsapp-link"
    };
  }

  approvalLink(session, requestId, approvalToken) {
    const baseUrl = String(process.env.APP_PUBLIC_URL || process.env.CLIENT_URL || "http://127.0.0.1:4300").replace(/\/+$/, "");
    const params = new URLSearchParams({
      approvalRequestId: requestId,
      sessionId: session.id
    });
    return `${baseUrl}/cash-drawer-approval/${approvalToken}?${params.toString()}`;
  }

  ownerApprovalRecipient(branchId, access = {}) {
    const settings = this.getSettings(branchId, access);
    if (settings.ownerRecipient) return settings.ownerRecipient;
    if (!hasTable("tenant_users")) return "owner";
    const owner = db.prepare(
      `SELECT *
         FROM tenant_users
        WHERE tenantId = @tenantId AND role IN ('owner', 'admin')
        ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, createdAt ASC
        LIMIT 1`
    ).get({ tenantId: access.tenantId });
    return owner?.phone || owner?.email || "owner";
  }

  approvalWhatsappMessage(session, risk, request = {}) {
    const variance = paiseToRupees(session.variancePaise || 0).toFixed(2);
    const expected = paiseToRupees(session.expectedCashPaise || 0).toFixed(2);
    const counted = paiseToRupees(session.countedCashPaise || 0).toFixed(2);
    return [
      `Aura Cash Risk Approval`,
      `Date: ${session.businessDate || istBusinessDate()}`,
      `Risk: ${risk.score}/100 ${risk.level}`,
      `Expected: ${expected}`,
      `Counted: ${counted}`,
      `Variance: ${variance}`,
      `Reason: ${request.reason || "review required"}`,
      `Open: ${request.approvalLink || ""}`
    ].join(" | ");
  }

  queueApprovalWhatsapp(session, payload = {}, access = {}) {
    if (!hasTable("message_logs")) return "";
    const messageId = makeId("msg");
    db.prepare(
      `INSERT INTO message_logs
        (id, tenantId, branchId, campaignId, clientId, channel, recipient, message, direction, status,
         providerMessageId, payload, providerResponse, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, '', '', 'whatsapp', @recipient, @message, 'outbound', 'queued',
         @providerMessageId, @payload, '{}', @createdAt, @updatedAt)`
    ).run({
      id: messageId,
      tenantId: access.tenantId,
      branchId: session.branch_id,
      recipient: payload.recipient || "owner",
      message: payload.whatsappMessage || "",
      providerMessageId: payload.deepLink || "",
      payload: JSON.stringify({
        source: "cashDrawerEodApproval",
        requestId: payload.requestId,
        sessionId: session.id,
        approvalLink: payload.approvalLink,
        whatsappDeepLink: payload.deepLink || ""
      }),
      createdAt: now(),
      updatedAt: now()
    });
    return messageId;
  }

  approvalToApi(row) {
    if (!row) return null;
    return {
      ...row,
      riskScore: Number(row.riskScore || 0),
      blockers: parseJson(row.blockers, []),
      metadata: parseJson(row.metadata, {}),
      approvalLink: row.approvalLink || "",
      whatsappMessageId: row.whatsappMessageId || "",
      whatsappMessage: row.whatsappMessage || "",
      whatsappDeepLink: row.whatsappDeepLink || ""
    };
  }

  reportForSession(session, access = {}) {
    const row = db.prepare(
      `SELECT *
         FROM cashDrawerEodReports
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    return this.reportToApi(row);
  }

  accountingSummary(sessionId, access = {}) {
    ensureCashDrawerEodSchema();
    const session = this.requireSession(sessionId, access);
    const businessDate = String(session.businessDate || istBusinessDate()).slice(0, 10);
    return {
      period: businessDate.slice(0, 7),
      periodLocked: Boolean(this.accountingPeriodLock(session, access)),
      posting: this.accountingPostingToApi(this.accountingPostingRow(session)),
      taxRegister: this.taxRegisterToApi(this.taxRegisterRow(session)),
      tallyExport: this.tallyExportToApi(this.latestTallyExportRow(session)),
      profitFeed: this.profitFeedToApi(this.profitFeedRow(session))
    };
  }

  postAccounting(sessionId, payload = {}, access = {}) {
    ensureCashDrawerEodSchema();
    const session = this.requireSession(sessionId, access);
    if (session.status !== "closed") throw badRequest("Close cash drawer before accounting posting");
    const locked = this.accountingPeriodLock(session, access);
    if (locked) throw badRequest(`Accounting period ${locked.period} is locked`, { blockers: ["ACCOUNTING_PERIOD_LOCKED"] });

    const existing = this.accountingPostingRow(session);
    if (existing?.status === "posted" && existing.journalEntryId) {
      return this.accountingSummary(sessionId, access);
    }

    const taxRegister = this.taxRegisterToApi(this.taxRegisterRow(session)) || this.buildTaxRegister(session, payload, access);
    const posting = this.buildAccountingPosting(session, taxRegister, access);
    if (!posting.lines.length) {
      const skipped = this.recordAccountingPosting(session, {
        status: "skipped",
        journalEntryId: "",
        debitPaise: 0,
        creditPaise: 0,
        lines: [],
        failureReason: "No cash, settlement, fee, tax or variance amount to post"
      }, access);
      this.recordProfitFeed(session, skipped, posting, access);
      return this.accountingSummary(sessionId, access);
    }

    try {
      const journal = balanceSheetService.createJournal({
        branchId: session.branch_id,
        businessDate: session.businessDate || istBusinessDate(),
        sourceType: "cashDrawerEod.close",
        sourceId: session.id,
        memo: `Cash drawer EOD close ${session.businessDate || istBusinessDate()}`,
        idempotencyKey: `cashDrawerEod:${access.tenantId}:${session.branch_id}:${session.id}:close`,
        lines: posting.lines.map((line) => ({
          accountId: line.accountId,
          debitPaise: line.debitPaise,
          creditPaise: line.creditPaise,
          memo: line.memo
        }))
      }, access);
      const saved = this.recordAccountingPosting(session, {
        status: "posted",
        journalEntryId: journal.id,
        debitPaise: posting.debitPaise,
        creditPaise: posting.creditPaise,
        lines: posting.lines,
        failureReason: ""
      }, access);
      this.recordProfitFeed(session, saved, posting, access);
      this.createTallyExport(session, saved, taxRegister, access);
      return this.accountingSummary(sessionId, access);
    } catch (error) {
      this.recordAccountingPosting(session, {
        status: "failed",
        journalEntryId: "",
        debitPaise: posting.debitPaise,
        creditPaise: posting.creditPaise,
        lines: posting.lines,
        failureReason: error?.message || "Accounting posting failed"
      }, access);
      throw error;
    }
  }

  taxRegister(sessionId, query = {}, access = {}) {
    ensureCashDrawerEodSchema();
    const session = this.requireSession(sessionId, access);
    return this.taxRegisterToApi(this.taxRegisterRow(session)) || this.buildTaxRegister(session, query, access);
  }

  tallyExport(sessionId, query = {}, access = {}) {
    ensureCashDrawerEodSchema();
    const session = this.requireSession(sessionId, access);
    const existing = this.latestTallyExportRow(session);
    if (existing && query.refresh !== "1" && query.refresh !== "true") return this.tallyExportToApi(existing);
    const posting = this.accountingPostingToApi(this.accountingPostingRow(session));
    if (!posting || posting.status !== "posted") throw badRequest("Accounting journal must be posted before Tally export");
    const taxRegister = this.taxRegisterToApi(this.taxRegisterRow(session)) || this.buildTaxRegister(session, query, access);
    return this.createTallyExport(session, posting, taxRegister, access);
  }

  ensureEodLedgerAccounts(tenantId, branchId) {
    ensureBalanceSheetSchema();
    const accounts = [
      ["1015", "Payment Settlement Receivable", "asset", "settlement_receivable", "debit"],
      ["2110", "VAT Payable", "liability", "tax", "credit"],
      ["5310", "Payment Gateway Charges", "expense", "bank_charges", "debit"],
      ["5600", "Petty Cash Expense", "expense", "petty_cash", "debit"],
      ["5900", "Cash Over Short", "expense", "cash_variance", "debit"]
    ];
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO chartOfAccounts
        (id, tenantId, branchId, code, name, accountType, accountSubType, normalBalance, systemAccount)
      VALUES
        (@id, @tenantId, @branchId, @code, @name, @accountType, @accountSubType, @normalBalance, 1)
    `);
    for (const [code, name, accountType, accountSubType, normalBalance] of accounts) {
      stmt.run({
        id: `coa_${tenantId}_${branchId || "tenant"}_${code}`.replace(/[^a-zA-Z0-9_]/g, "_"),
        tenantId,
        branchId,
        code,
        name,
        accountType,
        accountSubType,
        normalBalance
      });
    }
  }

  buildAccountingPosting(session, taxRegister, access = {}) {
    this.ensureEodLedgerAccounts(access.tenantId, session.branch_id);
    const accounts = new Map(balanceSheetService.accounts({ branchId: session.branch_id }, access).map((account) => [account.code, account]));
    const collections = this.collections(session);
    const settlements = this.settlements(session);
    const cashCollectionPaise = collections
      .filter((row) => normalizeMode(row.mode) === "cash")
      .reduce((sum, row) => sum + Number(row.finalAmountPaise || 0), 0);
    const nonCashGrossPaise = collections
      .filter((row) => NON_CASH_MODES.has(normalizeMode(row.mode)))
      .reduce((sum, row) => sum + Number(row.finalAmountPaise || 0), 0);
    const gatewayChargePaise = settlements.reduce((sum, row) => sum + Number(row.settlementChargePaise || 0), 0);
    const bankSettlementPaise = Math.max(0, nonCashGrossPaise - gatewayChargePaise);
    const variancePaise = Number(session.variancePaise || 0);
    const pettyCashPayoutPaise = Number(session.pettyCashPayoutPaise || 0);
    const outputTaxPaise = Math.min(Number(taxRegister?.outputTaxPaise || 0), cashCollectionPaise + nonCashGrossPaise);
    const revenuePaise = Math.max(0, cashCollectionPaise + nonCashGrossPaise - outputTaxPaise);
    const shortagePaise = variancePaise < 0 ? Math.abs(variancePaise) : 0;
    const overagePaise = variancePaise > 0 ? variancePaise : 0;
    const cashDebitPaise = variancePaise < 0
      ? Math.max(0, cashCollectionPaise + variancePaise)
      : cashCollectionPaise + variancePaise;
    const extraCashCreditPaise = Math.max(0, shortagePaise - cashCollectionPaise);
    const lines = [];
    const push = (code, debitPaise, creditPaise, memo) => {
      const debit = toInteger(debitPaise);
      const credit = toInteger(creditPaise);
      if (debit <= 0 && credit <= 0) return;
      const account = accounts.get(code);
      if (!account) throw badRequest(`Missing ledger account ${code}`);
      lines.push({
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        debitPaise: Math.max(0, debit),
        creditPaise: Math.max(0, credit),
        memo
      });
    };

    push("1000", cashDebitPaise, 0, "Cash collected at EOD close");
    push("1010", bankSettlementPaise, 0, "Net bank settlement from non-cash modes");
    push("5310", gatewayChargePaise, 0, "Card/UPI/MDR settlement charges");
    push("5900", shortagePaise, 0, "Cash shortage at EOD close");
    push("5600", pettyCashPayoutPaise, 0, "Petty cash payout recorded from drawer");
    push("1000", 0, extraCashCreditPaise, "Cash shortage beyond same-day cash collection");
    push("1000", 0, pettyCashPayoutPaise, "Petty cash payout from drawer");
    push("4000", 0, revenuePaise, "POS service/product sales net of output tax");
    push(taxRegister?.taxType === "VAT" ? "2110" : "2100", 0, outputTaxPaise, `${taxRegister?.taxType || "GST"} output tax payable`);
    push("5900", 0, overagePaise, "Cash overage at EOD close");

    const debitPaise = lines.reduce((sum, row) => sum + row.debitPaise, 0);
    const creditPaise = lines.reduce((sum, row) => sum + row.creditPaise, 0);
    if (debitPaise !== creditPaise) throw badRequest("Cash drawer accounting entry is not balanced");
    return {
      lines,
      debitPaise,
      creditPaise,
      totals: {
        cashCollectionPaise,
        nonCashGrossPaise,
        bankSettlementPaise,
        gatewayChargePaise,
        variancePaise,
        pettyCashPayoutPaise,
        outputTaxPaise,
        revenuePaise
      }
    };
  }

  buildTaxRegister(session, payload = {}, access = {}) {
    const country = String(payload.country || payload.taxCountry || "IN").toUpperCase();
    const taxType = String(payload.taxType || (VAT_COUNTRIES.has(country) ? "VAT" : "GST")).toUpperCase();
    const invoiceRows = this.paidInvoiceTaxRows(session, access);
    const collectionGrossPaise = this.collections(session).reduce((sum, row) => sum + Number(row.finalAmountPaise || 0), 0);
    const grossSalesPaise = invoiceRows.reduce((sum, row) => sum + row.grossPaise, 0) || collectionGrossPaise;
    const outputTaxPaise = Math.min(grossSalesPaise, invoiceRows.reduce((sum, row) => sum + row.taxPaise, 0));
    const stamp = now();
    const existing = this.taxRegisterRow(session);
    const id = existing?.id || makeId("eodtax");
    const registerJson = {
      source: "cashDrawerEod",
      sessionId: session.id,
      invoiceCount: invoiceRows.length,
      invoices: invoiceRows.slice(0, 250),
      collectionGrossPaise
    };
    db.prepare(
      `INSERT INTO cashDrawerEodTaxRegisters
        (id, tenantId, branchId, sessionId, businessDate, country, taxType, grossSalesPaise,
         taxableSalesPaise, outputTaxPaise, gstPaise, vatPaise, invoiceCount, registerJson, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @businessDate, @country, @taxType, @grossSalesPaise,
         @taxableSalesPaise, @outputTaxPaise, @gstPaise, @vatPaise, @invoiceCount, @registerJson, @createdAt, @updatedAt)
       ON CONFLICT(tenantId, branchId, sessionId)
       DO UPDATE SET
         country = excluded.country,
         taxType = excluded.taxType,
         grossSalesPaise = excluded.grossSalesPaise,
         taxableSalesPaise = excluded.taxableSalesPaise,
         outputTaxPaise = excluded.outputTaxPaise,
         gstPaise = excluded.gstPaise,
         vatPaise = excluded.vatPaise,
         invoiceCount = excluded.invoiceCount,
         registerJson = excluded.registerJson,
         updatedAt = excluded.updatedAt`
    ).run({
      id,
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      businessDate: session.businessDate || istBusinessDate(),
      country,
      taxType,
      grossSalesPaise,
      taxableSalesPaise: Math.max(0, grossSalesPaise - outputTaxPaise),
      outputTaxPaise,
      gstPaise: taxType === "GST" ? outputTaxPaise : 0,
      vatPaise: taxType === "VAT" ? outputTaxPaise : 0,
      invoiceCount: invoiceRows.length,
      registerJson: JSON.stringify(registerJson),
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp
    });
    const saved = this.taxRegisterToApi(this.taxRegisterRow(session));
    db.prepare(
      `UPDATE cashDrawerEodReports
          SET taxRegisterId = @taxRegisterId
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).run({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id, taxRegisterId: saved.id });
    return saved;
  }

  paidInvoiceTaxRows(session, access = {}) {
    if (!hasTable("invoice_payments") || !hasTable("invoices")) return [];
    const columns = tableColumns("invoices");
    const rows = db.prepare(`
      SELECT
        i.id AS id,
        ${selectColumn(columns, ["invoice_no", "invoiceNo", "number", "invoiceNumber"], "invoiceNo", "i.id")},
        ${selectColumn(columns, ["totalPaise", "grandTotalPaise", "totalAmountPaise", "total_paise"], "grossPaiseRaw")},
        ${selectColumn(columns, ["grand_total", "grandTotal", "total_amount", "totalAmount", "amount", "total"], "grossRupeesRaw")},
        ${selectColumn(columns, ["gstPaise", "gstAmountPaise", "taxPaise"], "taxPaiseRaw")},
        ${selectColumn(columns, ["gstAmount", "gst_amount", "taxAmount", "tax_total"], "taxRupeesRaw")},
        (
          SELECT COALESCE(SUM(ip2.amount), 0)
            FROM invoice_payments ip2
           WHERE ip2.tenant_id = i.tenant_id
             AND ip2.invoice_id = i.id
             AND ip2.status = 'paid'
             AND date(COALESCE(NULLIF(ip2.paid_at, ''), ip2.created_at)) = date(@businessDate)
        ) AS paidAmountRupees
      FROM invoices i
      WHERE i.tenant_id = @tenantId
        AND i.branch_id = @branchId
        AND EXISTS (
          SELECT 1
            FROM invoice_payments ip
           WHERE ip.tenant_id = i.tenant_id
             AND ip.invoice_id = i.id
             AND ip.status = 'paid'
             AND date(COALESCE(NULLIF(ip.paid_at, ''), ip.created_at)) = date(@businessDate)
        )
      ORDER BY i.id ASC
    `).all({ tenantId: access.tenantId, branchId: session.branch_id, businessDate: session.businessDate || istBusinessDate() });
    return rows.map((row) => {
      const grossPaise = amountPaiseFromRow(row, ["grossPaiseRaw"], ["grossRupeesRaw"]) || rupeesToPaise(row.paidAmountRupees);
      const taxPaise = Math.min(grossPaise, amountPaiseFromRow(row, ["taxPaiseRaw"], ["taxRupeesRaw"]));
      return {
        invoiceId: row.id,
        invoiceNo: row.invoiceNo || row.id,
        grossPaise,
        taxablePaise: Math.max(0, grossPaise - taxPaise),
        taxPaise
      };
    });
  }

  recordAccountingPosting(session, data = {}, access = {}) {
    const stamp = now();
    const existing = this.accountingPostingRow(session);
    const id = existing?.id || makeId("eodacct");
    db.prepare(
      `INSERT INTO cashDrawerEodAccountingPostings
        (id, tenantId, branchId, sessionId, businessDate, journalEntryId, status, debitPaise, creditPaise,
         lineBreakdown, failureReason, postedBy, postedAt, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @businessDate, @journalEntryId, @status, @debitPaise, @creditPaise,
         @lineBreakdown, @failureReason, @postedBy, @postedAt, @createdAt, @updatedAt)
       ON CONFLICT(tenantId, branchId, sessionId)
       DO UPDATE SET
         journalEntryId = excluded.journalEntryId,
         status = excluded.status,
         debitPaise = excluded.debitPaise,
         creditPaise = excluded.creditPaise,
         lineBreakdown = excluded.lineBreakdown,
         failureReason = excluded.failureReason,
         postedBy = excluded.postedBy,
         postedAt = excluded.postedAt,
         updatedAt = excluded.updatedAt`
    ).run({
      id,
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      businessDate: session.businessDate || istBusinessDate(),
      journalEntryId: data.journalEntryId || "",
      status: data.status || "pending",
      debitPaise: toInteger(data.debitPaise),
      creditPaise: toInteger(data.creditPaise),
      lineBreakdown: JSON.stringify(data.lines || []),
      failureReason: data.failureReason || "",
      postedBy: access.userId || "system",
      postedAt: data.status === "posted" ? stamp : "",
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp
    });
    const saved = this.accountingPostingToApi(this.accountingPostingRow(session));
    db.prepare(
      `UPDATE cashDrawerEodReports
          SET journalEntryId = @journalEntryId,
              accountingStatus = @accountingStatus
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).run({
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      journalEntryId: saved.journalEntryId || "",
      accountingStatus: saved.status || "pending"
    });
    return saved;
  }

  recordProfitFeed(session, posting, builtPosting = {}, access = {}) {
    const stamp = now();
    const existing = this.profitFeedRow(session);
    const id = existing?.id || makeId("eodprofit");
    const totals = builtPosting.totals || {};
    const payloadJson = {
      source: "cashDrawerEod",
      sessionId: session.id,
      journalEntryId: posting?.journalEntryId || "",
      cashPositionPaise: Number(session.countedCashPaise || 0),
      bankSettlementPaise: Number(totals.bankSettlementPaise || 0),
      gatewayChargePaise: Number(totals.gatewayChargePaise || 0),
      variancePaise: Number(session.variancePaise || 0)
    };
    db.prepare(
      `INSERT INTO cashDrawerEodProfitFeeds
        (id, tenantId, branchId, sessionId, businessDate, cashPositionPaise, bankSettlementPaise,
         gatewayChargePaise, variancePaise, journalEntryId, payloadJson, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @businessDate, @cashPositionPaise, @bankSettlementPaise,
         @gatewayChargePaise, @variancePaise, @journalEntryId, @payloadJson, @createdAt, @updatedAt)
       ON CONFLICT(tenantId, branchId, sessionId)
       DO UPDATE SET
         cashPositionPaise = excluded.cashPositionPaise,
         bankSettlementPaise = excluded.bankSettlementPaise,
         gatewayChargePaise = excluded.gatewayChargePaise,
         variancePaise = excluded.variancePaise,
         journalEntryId = excluded.journalEntryId,
         payloadJson = excluded.payloadJson,
         updatedAt = excluded.updatedAt`
    ).run({
      id,
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      businessDate: session.businessDate || istBusinessDate(),
      cashPositionPaise: payloadJson.cashPositionPaise,
      bankSettlementPaise: payloadJson.bankSettlementPaise,
      gatewayChargePaise: payloadJson.gatewayChargePaise,
      variancePaise: payloadJson.variancePaise,
      journalEntryId: payloadJson.journalEntryId,
      payloadJson: JSON.stringify(payloadJson),
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp
    });
    return this.profitFeedToApi(this.profitFeedRow(session));
  }

  createTallyExport(session, posting, taxRegister, access = {}) {
    const rows = [
      ["VoucherDate", "VoucherType", "VoucherNo", "Ledger", "DebitPaise", "CreditPaise", "Narration"],
      ...(posting.lineBreakdown || []).map((line) => [
        session.businessDate || istBusinessDate(),
        "Journal",
        posting.journalEntryId || session.id,
        `${line.accountCode} ${line.accountName}`,
        line.debitPaise || 0,
        line.creditPaise || 0,
        line.memo || ""
      ]),
      ["", "TaxRegister", taxRegister?.id || "", taxRegister?.taxType || "GST", taxRegister?.outputTaxPaise || 0, 0, "Output tax register"]
    ];
    const content = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const stamp = now();
    const id = makeId("eodtally");
    db.prepare(
      `INSERT INTO cashDrawerEodTallyExports
        (id, tenantId, branchId, sessionId, businessDate, format, fileName, content, createdBy, createdAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @businessDate, 'csv', @fileName, @content, @createdBy, @createdAt)`
    ).run({
      id,
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      businessDate: session.businessDate || istBusinessDate(),
      fileName: `cash-eod-${session.businessDate || istBusinessDate()}-${session.branch_id}.csv`,
      content,
      createdBy: access.userId || "system",
      createdAt: stamp
    });
    db.prepare(
      `UPDATE cashDrawerEodReports
          SET tallyExportId = @tallyExportId
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).run({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id, tallyExportId: id });
    return this.tallyExportToApi(this.latestTallyExportRow(session));
  }

  accountingPostingRow(session) {
    return db.prepare(
      `SELECT *
         FROM cashDrawerEodAccountingPostings
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).get({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id });
  }

  taxRegisterRow(session) {
    return db.prepare(
      `SELECT *
         FROM cashDrawerEodTaxRegisters
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).get({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id });
  }

  latestTallyExportRow(session) {
    return db.prepare(
      `SELECT *
         FROM cashDrawerEodTallyExports
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
        ORDER BY createdAt DESC LIMIT 1`
    ).get({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id });
  }

  profitFeedRow(session) {
    return db.prepare(
      `SELECT *
         FROM cashDrawerEodProfitFeeds
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).get({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id });
  }

  accountingPostingToApi(row) {
    if (!row) return null;
    return { ...row, lineBreakdown: parseJson(row.lineBreakdown, []) };
  }

  taxRegisterToApi(row) {
    if (!row) return null;
    return { ...row, registerJson: parseJson(row.registerJson, {}) };
  }

  tallyExportToApi(row) {
    if (!row) return null;
    return row;
  }

  profitFeedToApi(row) {
    if (!row) return null;
    return { ...row, payloadJson: parseJson(row.payloadJson, {}) };
  }

  todayReport(query = {}, access = {}) {
    const branchId = getBranchId(query, access);
    const businessDate = query.businessDate || query.business_date || query.date || istBusinessDate();
    const row = db.prepare(
      `SELECT *
         FROM cashDrawerEodReports
        WHERE tenantId = @tenantId AND branchId = @branchId AND businessDate = @businessDate
        ORDER BY createdAt DESC LIMIT 1`
    ).get({ tenantId: access.tenantId, branchId, businessDate });
    return row ? this.reportToApi(row) : null;
  }

  previousClosedSession(branchId, businessDate, access = {}) {
    return db.prepare(
      `SELECT *
         FROM cash_drawer_sessions
        WHERE tenant_id = @tenantId
          AND branch_id = @branchId
          AND status = 'closed'
          AND businessDate < @businessDate
        ORDER BY businessDate DESC, closed_at DESC
        LIMIT 1`
    ).get({ tenantId: access.tenantId, branchId, businessDate });
  }

  ensureDefaultTill(session, access = {}) {
    const existing = db.prepare(
      `SELECT *
         FROM cashDrawerEodTills
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
        ORDER BY openedAt ASC LIMIT 1`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    if (existing) return existing;
    const stamp = now();
    const id = makeId("till");
    db.prepare(
      `INSERT INTO cashDrawerEodTills
        (id, tenantId, branchId, sessionId, tillName, cashierId, openingFloatPaise, expectedCashPaise,
         status, openedBy, openedAt, notes, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, 'Main till', @cashierId, @openingFloatPaise, @openingFloatPaise,
         @status, @openedBy, @openedAt, 'Auto-created from EOD session', @createdAt, @updatedAt)`
    ).run({
      id,
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      cashierId: session.cashier_id || session.openedBy || access.userId || "",
      openingFloatPaise: Number(session.openingBalancePaise || 0),
      status: session.status === "closed" ? "closed" : "open",
      openedBy: session.openedBy || access.userId || "",
      openedAt: session.opened_at || stamp,
      createdAt: stamp,
      updatedAt: stamp
    });
    db.prepare(
      `UPDATE cash_drawer_sessions
          SET primaryTillId = @primaryTillId
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
    ).run({ tenantId: access.tenantId, branchId: session.branch_id, id: session.id, primaryTillId: id });
    return this.requireTill(id, access);
  }

  resolveTillId(session, tillId, access = {}) {
    if (tillId) {
      const till = this.requireTill(tillId, access);
      if (till.sessionId !== session.id) throw badRequest("Till does not belong to this session");
      return till.id;
    }
    return this.ensureDefaultTill(session, access).id;
  }

  requireTill(tillId, access = {}) {
    const till = db.prepare(
      `SELECT *
         FROM cashDrawerEodTills
        WHERE tenantId = @tenantId AND id = @id`
    ).get({ tenantId: access.tenantId, id: tillId });
    if (!till) throw notFound("Cash drawer till not found");
    tenantService.assertBranchAccess(access, till.branchId);
    return till;
  }

  requireCashOperation(operationId, access = {}) {
    const operation = db.prepare(
      `SELECT *
         FROM cashDrawerEodCashOperations
        WHERE tenantId = @tenantId AND id = @id`
    ).get({ tenantId: access.tenantId, id: operationId });
    if (!operation) throw notFound("Cash operation not found");
    tenantService.assertBranchAccess(access, operation.branchId);
    return operation;
  }

  cashOperations(session, tillId = "") {
    const rows = db.prepare(
      `SELECT *
         FROM cashDrawerEodCashOperations
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
          AND (@tillId = '' OR tillId = @tillId)
        ORDER BY entryAt DESC, createdAt DESC`
    ).all({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id, tillId });
    return rows.map((row) => ({
      ...row,
      amountPaise: Number(row.amountPaise || 0),
      impactPaise: Number(row.impactPaise || 0)
    }));
  }

  operationTotals(session, tillId = "") {
    const rows = this.cashOperations(session, tillId);
    return rows.reduce((totals, row) => {
      const amountPaise = Number(row.amountPaise || 0);
      totals[row.type] = Number(totals[row.type] || 0) + amountPaise;
      totals.impactPaise += Number(row.impactPaise || 0);
      return totals;
    }, { drop: 0, pickup: 0, payout: 0, impactPaise: 0 });
  }

  tills(session, access = {}, options = {}) {
    if (options.ensure !== false) this.ensureDefaultTill(session, access);
    return db.prepare(
      `SELECT *
         FROM cashDrawerEodTills
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
        ORDER BY openedAt ASC`
    ).all({ tenantId: access.tenantId || session.tenant_id, branchId: session.branch_id, sessionId: session.id }).map((row) => ({
      ...row,
      openingFloatPaise: Number(row.openingFloatPaise || 0),
      cashCollectedPaise: Number(row.cashCollectedPaise || 0),
      cashDropPaise: Number(row.cashDropPaise || 0),
      cashPickupPaise: Number(row.cashPickupPaise || 0),
      pettyCashPayoutPaise: Number(row.pettyCashPayoutPaise || 0),
      expectedCashPaise: Number(row.expectedCashPaise || 0),
      countedCashPaise: Number(row.countedCashPaise || 0),
      variancePaise: Number(row.variancePaise || 0)
    }));
  }

  recalculateTills(session, access = {}) {
    const tills = this.tills(session, access);
    const singleTillId = tills.length === 1 ? tills[0].id : "";
    for (const till of tills) {
      const totals = this.operationTotals(session, till.id);
      const cashCollectedPaise = singleTillId === till.id ? Number(session.cashCollectedPaise || 0) : Number(till.cashCollectedPaise || 0);
      const manualCashPayoutPaise = singleTillId === till.id ? Number(session.cashPayoutPaise || 0) : 0;
      const expectedCashPaise = Number(till.openingFloatPaise || 0) + cashCollectedPaise - manualCashPayoutPaise + totals.impactPaise;
      const countedCashPaise = Number(till.countedCashPaise || 0);
      db.prepare(
        `UPDATE cashDrawerEodTills
            SET cashCollectedPaise = @cashCollectedPaise,
                cashDropPaise = @cashDropPaise,
                cashPickupPaise = @cashPickupPaise,
                pettyCashPayoutPaise = @pettyCashPayoutPaise,
                expectedCashPaise = @expectedCashPaise,
                variancePaise = @variancePaise,
                updatedAt = @updatedAt
          WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
      ).run({
        tenantId: access.tenantId,
        branchId: session.branch_id,
        id: till.id,
        cashCollectedPaise,
        cashDropPaise: totals.drop,
        cashPickupPaise: totals.pickup,
        pettyCashPayoutPaise: totals.payout,
        expectedCashPaise,
        variancePaise: countedCashPaise - expectedCashPaise,
        updatedAt: now()
      });
    }
  }

  handovers(session) {
    return db.prepare(
      `SELECT *
         FROM cashDrawerEodHandovers
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
        ORDER BY handedOverAt DESC`
    ).all({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id }).map((row) => ({
      ...row,
      countedCashPaise: Number(row.countedCashPaise || 0),
      countBreakdown: parseJson(row.countBreakdown, [])
    }));
  }

  floatSuggestionForSession(session) {
    const denominations = this.denominations(session);
    const targetPaise = Math.min(Number(session.countedCashPaise || 0), 300000);
    const plan = [
      { denominationPaise: 10000, kind: "note", maxQty: 10 },
      { denominationPaise: 5000, kind: "note", maxQty: 12 },
      { denominationPaise: 2000, kind: "note", maxQty: 20 },
      { denominationPaise: 1000, kind: "note", maxQty: 30 },
      { denominationPaise: 500, kind: "coin", maxQty: 30 },
      { denominationPaise: 200, kind: "coin", maxQty: 40 },
      { denominationPaise: 100, kind: "coin", maxQty: 50 }
    ];
    let remaining = targetPaise;
    const keepBreakdown = [];
    for (const item of plan) {
      const qty = Math.min(item.maxQty, Math.floor(remaining / item.denominationPaise));
      if (qty > 0) {
        keepBreakdown.push({ ...item, qty, subtotalPaise: qty * item.denominationPaise });
        remaining -= qty * item.denominationPaise;
      }
    }
    const suggestedFloatPaise = keepBreakdown.reduce((sum, row) => sum + row.subtotalPaise, 0);
    const largeNotes = denominations
      .filter((row) => row.kind === "note" && Number(row.denominationPaise || 0) >= 50000 && Number(row.qty || 0) > 0)
      .map((row) => ({
        denominationPaise: Number(row.denominationPaise || 0),
        qty: Number(row.qty || 0),
        subtotalPaise: Number(row.subtotalPaise || 0)
      }));
    const largeNotePaise = largeNotes.reduce((sum, row) => sum + row.subtotalPaise, 0);
    const countedCashPaise = Number(session.countedCashPaise || 0);
    return {
      targetFloatPaise: targetPaise,
      suggestedFloatPaise,
      keepBreakdown,
      safeMovePaise: Math.max(0, countedCashPaise - suggestedFloatPaise),
      largeNotePaise,
      largeNotes
    };
  }

  requireSession(sessionId, access = {}) {
    const session = db.prepare(
      `SELECT *
         FROM cash_drawer_sessions
        WHERE tenant_id = @tenantId AND id = @id`
    ).get({ tenantId: access.tenantId, id: sessionId });
    if (!session) throw notFound("Cash drawer EOD session not found");
    tenantService.assertBranchAccess(access, session.branch_id);
    return session;
  }

  assertOpen(session) {
    if (session.status === "closed") throw conflict("Cash drawer EOD session is already closed");
  }

  syncCollections(session, access = {}) {
    const totals = this.invoicePaymentTotals(session, access);
    const previousRows = db.prepare(
      `SELECT *
         FROM cashDrawerEodCollections
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).all({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    const previous = new Map(previousRows.map((row) => [row.mode, row]));
    const stamp = now();
    const upsert = db.prepare(
      `INSERT INTO cashDrawerEodCollections
        (id, tenantId, branchId, sessionId, mode, autoAmountPaise, finalAmountPaise, manualAdjustmentPaise,
         adjustmentReason, updatedBy, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @mode, @autoAmountPaise, @finalAmountPaise, @manualAdjustmentPaise,
         @adjustmentReason, @updatedBy, @createdAt, @updatedAt)
       ON CONFLICT(tenantId, branchId, sessionId, mode)
       DO UPDATE SET
         autoAmountPaise = excluded.autoAmountPaise,
         finalAmountPaise = excluded.finalAmountPaise,
         manualAdjustmentPaise = excluded.manualAdjustmentPaise,
         adjustmentReason = excluded.adjustmentReason,
         updatedBy = excluded.updatedBy,
         updatedAt = excluded.updatedAt`
    );
    for (const mode of MODES) {
      const autoAmountPaise = Number(totals.amounts[mode] || 0);
      const old = previous.get(mode);
      const hasManual = old && (Number(old.manualAdjustmentPaise || 0) !== 0 || Boolean(old.adjustmentReason));
      const finalAmountPaise = hasManual ? Number(old.finalAmountPaise || 0) : autoAmountPaise;
      upsert.run({
        id: old?.id || makeId("eodcol"),
        tenantId: access.tenantId,
        branchId: session.branch_id,
        sessionId: session.id,
        mode,
        autoAmountPaise,
        finalAmountPaise,
        manualAdjustmentPaise: finalAmountPaise - autoAmountPaise,
        adjustmentReason: old?.adjustmentReason || "",
        updatedBy: old?.updatedBy || "",
        createdAt: old?.createdAt || stamp,
        updatedAt: stamp
      });
    }
    this.seedSettlementRows(session, access);
    this.recalculateSession(session.id, access, totals.invoiceCount);
  }

  setCollection(session, payload = {}, access = {}) {
    const mode = normalizeMode(payload.mode || payload.paymentMode);
    const existing = db.prepare(
      `SELECT *
         FROM cashDrawerEodCollections
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId AND mode = @mode`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id, mode });
    const finalAmountPaise = toInteger(payload.finalAmountPaise ?? payload.amountPaise ?? payload.amount_paise ?? 0);
    const autoAmountPaise = Number(existing?.autoAmountPaise || 0);
    const stamp = now();
    db.prepare(
      `INSERT INTO cashDrawerEodCollections
        (id, tenantId, branchId, sessionId, mode, autoAmountPaise, finalAmountPaise, manualAdjustmentPaise,
         adjustmentReason, updatedBy, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @mode, @autoAmountPaise, @finalAmountPaise, @manualAdjustmentPaise,
         @adjustmentReason, @updatedBy, @createdAt, @updatedAt)
       ON CONFLICT(tenantId, branchId, sessionId, mode)
       DO UPDATE SET
         finalAmountPaise = excluded.finalAmountPaise,
         manualAdjustmentPaise = excluded.manualAdjustmentPaise,
         adjustmentReason = excluded.adjustmentReason,
         updatedBy = excluded.updatedBy,
         updatedAt = excluded.updatedAt`
    ).run({
      id: existing?.id || makeId("eodcol"),
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      mode,
      autoAmountPaise,
      finalAmountPaise,
      manualAdjustmentPaise: finalAmountPaise - autoAmountPaise,
      adjustmentReason: payload.adjustmentReason || payload.reason || "",
      updatedBy: access.userId || "",
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp
    });
    db.prepare(
      `INSERT INTO cashDrawerEodCollectionAdjustments
        (id, tenantId, branchId, sessionId, mode, previousFinalAmountPaise, nextFinalAmountPaise, reason, changedBy, createdAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @mode, @previousFinalAmountPaise, @nextFinalAmountPaise, @reason, @changedBy, @createdAt)`
    ).run({
      id: makeId("eodadj"),
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      mode,
      previousFinalAmountPaise: Number(existing?.finalAmountPaise || 0),
      nextFinalAmountPaise: finalAmountPaise,
      reason: payload.adjustmentReason || payload.reason || "",
      changedBy: access.userId || "",
      createdAt: stamp
    });
    this.seedSettlementRows(session, access);
  }

  saveSettlement(session, payload = {}, access = {}) {
    const mode = normalizeMode(payload.mode || payload.paymentMode);
    if (isCashMode(mode)) throw badRequest("Cash mode does not need bank settlement");
    const existing = db.prepare(
      `SELECT *
         FROM cashDrawerEodSettlements
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId AND mode = @mode`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id, mode });
    const collection = db.prepare(
      `SELECT *
         FROM cashDrawerEodCollections
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId AND mode = @mode`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id, mode });
    const grossPaise = toInteger(payload.grossPaise ?? payload.gross_paise ?? collection?.finalAmountPaise ?? existing?.grossPaise ?? 0);
    const settlementChargePaise = toInteger(payload.settlementChargePaise ?? payload.settlement_charge_paise ?? existing?.settlementChargePaise ?? 0);
    const netPaise = grossPaise - settlementChargePaise;
    const reconciled = payload.reconciled === undefined ? Number(existing?.reconciled || 0) : (payload.reconciled ? 1 : 0);
    const settlementStatus = reconciled ? "matched" : "pending";
    const creditedAt = reconciled ? (payload.creditedAt || payload.credited_at || existing?.creditedAt || now()) : "";
    const stamp = now();
    db.prepare(
      `INSERT INTO cashDrawerEodSettlements
        (id, tenantId, branchId, sessionId, mode, grossPaise, settlementChargePaise, netPaise, bankRef,
         reconciled, updatedBy, createdAt, updatedAt, settlementStatus, creditedAt, importBatchId, matchedInvoiceIds)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @mode, @grossPaise, @settlementChargePaise, @netPaise, @bankRef,
         @reconciled, @updatedBy, @createdAt, @updatedAt, @settlementStatus, @creditedAt, @importBatchId, @matchedInvoiceIds)
       ON CONFLICT(tenantId, branchId, sessionId, mode)
       DO UPDATE SET
         grossPaise = excluded.grossPaise,
         settlementChargePaise = excluded.settlementChargePaise,
         netPaise = excluded.netPaise,
         bankRef = excluded.bankRef,
         reconciled = excluded.reconciled,
         updatedBy = excluded.updatedBy,
         updatedAt = excluded.updatedAt,
         settlementStatus = excluded.settlementStatus,
         creditedAt = excluded.creditedAt`
    ).run({
      id: existing?.id || makeId("eodset"),
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      mode,
      grossPaise,
      settlementChargePaise,
      netPaise,
      bankRef: payload.bankRef ?? payload.bank_ref ?? existing?.bankRef ?? "",
      reconciled,
      updatedBy: access.userId || "",
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp,
      settlementStatus,
      creditedAt,
      importBatchId: existing?.importBatchId || "",
      matchedInvoiceIds: existing?.matchedInvoiceIds || "[]"
    });
    return this.summary(session.id, access);
  }

  seedSettlementRows(session, access = {}) {
    const rows = db.prepare(
      `SELECT *
         FROM cashDrawerEodCollections
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
          AND mode <> 'cash' AND finalAmountPaise > 0`
    ).all({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    const stamp = now();
    const upsert = db.prepare(
      `INSERT INTO cashDrawerEodSettlements
        (id, tenantId, branchId, sessionId, mode, grossPaise, settlementChargePaise, netPaise, bankRef,
         reconciled, updatedBy, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @mode, @grossPaise, 0, @grossPaise, '', 0, '', @createdAt, @updatedAt)
       ON CONFLICT(tenantId, branchId, sessionId, mode)
       DO UPDATE SET
         grossPaise = excluded.grossPaise,
         netPaise = excluded.grossPaise - settlementChargePaise,
         updatedAt = excluded.updatedAt`
    );
    for (const row of rows) {
      upsert.run({
        id: makeId("eodset"),
        tenantId: access.tenantId,
        branchId: session.branch_id,
        sessionId: session.id,
        mode: row.mode,
        grossPaise: Number(row.finalAmountPaise || 0),
        createdAt: stamp,
        updatedAt: stamp
      });
    }
  }

  invoicePaymentTotals(session, access = {}) {
    if (!hasTable("invoice_payments") || !hasTable("invoices")) return { amounts: {}, invoiceCount: 0 };
    const rows = db.prepare(
      `SELECT ip.payment_mode AS mode, SUM(ip.amount) AS amount
         FROM invoice_payments ip
         JOIN invoices i ON i.tenant_id = ip.tenant_id AND i.id = ip.invoice_id
        WHERE ip.tenant_id = @tenantId
          AND i.branch_id = @branchId
          AND ip.status = 'paid'
          AND date(COALESCE(NULLIF(ip.paid_at, ''), ip.created_at)) = date(@businessDate)
        GROUP BY ip.payment_mode`
    ).all({ tenantId: access.tenantId, branchId: session.branch_id, businessDate: session.businessDate || istBusinessDate() });
    const count = db.prepare(
      `SELECT COUNT(DISTINCT ip.invoice_id) AS invoiceCount
         FROM invoice_payments ip
         JOIN invoices i ON i.tenant_id = ip.tenant_id AND i.id = ip.invoice_id
        WHERE ip.tenant_id = @tenantId
          AND i.branch_id = @branchId
          AND ip.status = 'paid'
          AND date(COALESCE(NULLIF(ip.paid_at, ''), ip.created_at)) = date(@businessDate)`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, businessDate: session.businessDate || istBusinessDate() });
    const amounts = {};
    for (const row of rows) {
      const mode = normalizeMode(row.mode);
      amounts[mode] = Number(amounts[mode] || 0) + rupeesToPaise(row.amount);
    }
    return { amounts, invoiceCount: Number(count?.invoiceCount || 0) };
  }

  recalculateSession(sessionId, access = {}, invoiceCount = undefined) {
    const session = this.requireSession(sessionId, access);
    const cash = db.prepare(
      `SELECT finalAmountPaise
         FROM cashDrawerEodCollections
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId AND mode = 'cash'`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId });
    const cashCollectedPaise = Number(cash?.finalAmountPaise || 0);
    const cashPayoutPaise = Number(session.cashPayoutPaise || 0);
    const operationTotals = this.operationTotals(session);
    const cashOperationImpactPaise = Number(operationTotals.impactPaise || 0);
    const openingBalancePaise = Number(session.openingBalancePaise || 0);
    const expectedCashPaise = openingBalancePaise + cashCollectedPaise - cashPayoutPaise + cashOperationImpactPaise;
    const countedCashPaise = Number(session.countedCashPaise || 0);
    const variancePaise = countedCashPaise - expectedCashPaise;
    db.prepare(
      `UPDATE cash_drawer_sessions
          SET cashCollectedPaise = @cashCollectedPaise,
              cashOperationImpactPaise = @cashOperationImpactPaise,
              cashDropPaise = @cashDropPaise,
              cashPickupPaise = @cashPickupPaise,
              pettyCashPayoutPaise = @pettyCashPayoutPaise,
              expectedCashPaise = @expectedCashPaise,
              variancePaise = @variancePaise,
              expected_cash = @expectedCash,
              cash_difference = @cashDifference
        WHERE tenant_id = @tenantId AND branch_id = @branchId AND id = @id`
    ).run({
      tenantId: access.tenantId,
      branchId: session.branch_id,
      id: session.id,
      cashCollectedPaise,
      cashOperationImpactPaise,
      cashDropPaise: Number(operationTotals.drop || 0),
      cashPickupPaise: Number(operationTotals.pickup || 0),
      pettyCashPayoutPaise: Number(operationTotals.payout || 0),
      expectedCashPaise,
      variancePaise,
      expectedCash: paiseToRupees(expectedCashPaise),
      cashDifference: paiseToRupees(variancePaise)
    });
    this.recalculateTills(this.requireSession(sessionId, access), access);
    if (invoiceCount !== undefined) {
      return invoiceCount;
    }
    return undefined;
  }

  accountingPeriodLock(session, access = {}) {
    ensureBalanceSheetSchema();
    const businessDate = String(session.businessDate || istBusinessDate()).slice(0, 10);
    const period = businessDate.slice(0, 7);
    return db.prepare(
      `SELECT *
         FROM periodLocks
        WHERE tenantId = @tenantId AND branchId = @branchId AND period = @period`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, period }) || null;
  }

  closeBlockers(session, access = {}, options = {}) {
    const blockers = [];
    if (!session) return ["SESSION_NOT_FOUND"];
    const risk = options.risk || (options.skipRisk ? null : this.riskSnapshot(session, access, { persist: false }));
    const riskApproved = risk?.approvalStatus === "approved";
    if (session.status === "closed") blockers.push("SESSION_ALREADY_CLOSED");
    if (this.accountingPeriodLock(session, access)) blockers.push("ACCOUNTING_PERIOD_LOCKED");
    const denomCount = db.prepare(
      `SELECT COUNT(*) AS total
         FROM cashDrawerEodDenominations
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    if (!Number(denomCount?.total || 0)) blockers.push("DENOMINATION_COUNT_MISSING");
    const variancePaise = Number(session.variancePaise || 0);
    if (variancePaise !== 0 && !riskApproved) {
      if (canOverride(access)) {
        if (!String(options.varianceReason || "").trim()) blockers.push("VARIANCE_REASON_REQUIRED");
      } else {
        blockers.push("CASH_VARIANCE_NOT_ZERO");
      }
    }
    const pendingSettlement = db.prepare(
      `SELECT COUNT(*) AS total
         FROM cashDrawerEodSettlements
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
          AND grossPaise > 0 AND reconciled = 0`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    if (Number(pendingSettlement?.total || 0)) blockers.push("SETTLEMENT_PENDING");
    if (session.status !== "closed") this.ensureDefaultTill(session, access);
    const openTills = db.prepare(
      `SELECT COUNT(*) AS total
         FROM cashDrawerEodTills
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
          AND status <> 'closed'`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    if (Number(openTills?.total || 0)) blockers.push("TILL_RECONCILIATION_PENDING");
    if (risk?.approvalNeeded && !riskApproved && session.status !== "closed") {
      blockers.push(risk.approvalStatus === "pending" ? "APPROVAL_PENDING" : "RISK_APPROVAL_REQUIRED");
    }
    return blockers;
  }

  freezeReport(session, access = {}) {
    const denominations = this.denominations(session);
    const collections = this.collections(session);
    const settlements = this.settlements(session);
    const operations = this.cashOperations(session);
    const tills = this.tills(session, access, { ensure: false });
    const handovers = this.handovers(session);
    const floatSuggestion = this.floatSuggestionForSession(session);
    const invoiceCount = this.invoicePaymentTotals(session, access).invoiceCount;
    const settings = this.getSettings(session.branch_id, access);
    const stamp = now();
    const existing = db.prepare(
      `SELECT *
         FROM cashDrawerEodReports
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    const id = existing?.id || makeId("eodrep");
    db.prepare(
      `INSERT INTO cashDrawerEodReports
        (id, tenantId, branchId, sessionId, businessDate, openingBalancePaise, cashCollectedPaise, cashPayoutPaise,
         cashOperationImpactPaise, cashDropPaise, cashPickupPaise, pettyCashPayoutPaise, safeMovePaise,
         expectedCashPaise, countedCashPaise, variancePaise, varianceReason, denominationBreakdown, modeWiseCollection,
         settlementBreakdown, tillBreakdown, operationBreakdown, handoverBreakdown, floatSuggestion, invoiceCount, closedBy, openedAt, closedAt, reportChannel, notificationStatus,
         notificationRef, createdAt)
       VALUES
        (@id, @tenantId, @branchId, @sessionId, @businessDate, @openingBalancePaise, @cashCollectedPaise, @cashPayoutPaise,
         @cashOperationImpactPaise, @cashDropPaise, @cashPickupPaise, @pettyCashPayoutPaise, @safeMovePaise,
         @expectedCashPaise, @countedCashPaise, @variancePaise, @varianceReason, @denominationBreakdown, @modeWiseCollection,
         @settlementBreakdown, @tillBreakdown, @operationBreakdown, @handoverBreakdown, @floatSuggestion, @invoiceCount, @closedBy, @openedAt, @closedAt, @reportChannel, 'pending', '', @createdAt)
       ON CONFLICT(tenantId, branchId, sessionId)
       DO UPDATE SET
         openingBalancePaise = excluded.openingBalancePaise,
         cashCollectedPaise = excluded.cashCollectedPaise,
         cashPayoutPaise = excluded.cashPayoutPaise,
         cashOperationImpactPaise = excluded.cashOperationImpactPaise,
         cashDropPaise = excluded.cashDropPaise,
         cashPickupPaise = excluded.cashPickupPaise,
         pettyCashPayoutPaise = excluded.pettyCashPayoutPaise,
         safeMovePaise = excluded.safeMovePaise,
         expectedCashPaise = excluded.expectedCashPaise,
         countedCashPaise = excluded.countedCashPaise,
         variancePaise = excluded.variancePaise,
         varianceReason = excluded.varianceReason,
         denominationBreakdown = excluded.denominationBreakdown,
         modeWiseCollection = excluded.modeWiseCollection,
         settlementBreakdown = excluded.settlementBreakdown,
         tillBreakdown = excluded.tillBreakdown,
         operationBreakdown = excluded.operationBreakdown,
         handoverBreakdown = excluded.handoverBreakdown,
         floatSuggestion = excluded.floatSuggestion,
         invoiceCount = excluded.invoiceCount,
         closedBy = excluded.closedBy,
         openedAt = excluded.openedAt,
         closedAt = excluded.closedAt,
         reportChannel = excluded.reportChannel`
    ).run({
      id,
      tenantId: access.tenantId,
      branchId: session.branch_id,
      sessionId: session.id,
      businessDate: session.businessDate || istBusinessDate(),
      openingBalancePaise: Number(session.openingBalancePaise || 0),
      cashCollectedPaise: Number(session.cashCollectedPaise || 0),
      cashPayoutPaise: Number(session.cashPayoutPaise || 0),
      cashOperationImpactPaise: Number(session.cashOperationImpactPaise || 0),
      cashDropPaise: Number(session.cashDropPaise || 0),
      cashPickupPaise: Number(session.cashPickupPaise || 0),
      pettyCashPayoutPaise: Number(session.pettyCashPayoutPaise || 0),
      safeMovePaise: Number(floatSuggestion.safeMovePaise || 0),
      expectedCashPaise: Number(session.expectedCashPaise || 0),
      countedCashPaise: Number(session.countedCashPaise || 0),
      variancePaise: Number(session.variancePaise || 0),
      varianceReason: session.varianceReason || "",
      denominationBreakdown: JSON.stringify(denominations),
      modeWiseCollection: JSON.stringify(collections),
      settlementBreakdown: JSON.stringify(settlements),
      tillBreakdown: JSON.stringify(tills),
      operationBreakdown: JSON.stringify(operations),
      handoverBreakdown: JSON.stringify(handovers),
      floatSuggestion: JSON.stringify(floatSuggestion),
      invoiceCount,
      closedBy: session.closedBy || access.userId || "",
      openedAt: session.opened_at || "",
      closedAt: session.closed_at || stamp,
      reportChannel: settings.reportChannel || "whatsapp,inapp",
      createdAt: stamp
    });
    const report = db.prepare(
      `SELECT *
         FROM cashDrawerEodReports
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId`
    ).get({ tenantId: access.tenantId, branchId: session.branch_id, sessionId: session.id });
    return this.queueOwnerReport(report, settings, access);
  }

  queueOwnerReport(report, settings, access = {}) {
    const channels = String(settings.reportChannel || "whatsapp,inapp").split(",").map((item) => item.trim());
    if (!channels.includes("whatsapp") || !hasTable("message_logs")) return this.reportToApi(report);
    const owner = db.prepare(
      `SELECT *
         FROM tenant_users
        WHERE tenantId = @tenantId AND role IN ('owner', 'admin')
        ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, createdAt ASC
        LIMIT 1`
    ).get({ tenantId: access.tenantId });
    const recipient = settings.ownerRecipient || owner?.phone || owner?.email || "owner";
    const messageId = makeId("msg");
    const message = [
      `EOD close ${report.businessDate}`,
      `Cash expected: ${paiseToRupees(report.expectedCashPaise).toFixed(2)}`,
      `Counted: ${paiseToRupees(report.countedCashPaise).toFixed(2)}`,
      `Variance: ${paiseToRupees(report.variancePaise).toFixed(2)}`,
      `Invoices: ${report.invoiceCount}`
    ].join(" | ");
    db.prepare(
      `INSERT INTO message_logs
        (id, tenantId, branchId, campaignId, clientId, channel, recipient, message, direction, status,
         providerMessageId, payload, providerResponse, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, '', '', 'whatsapp', @recipient, @message, 'outbound', 'queued',
         '', @payload, '{}', @createdAt, @updatedAt)`
    ).run({
      id: messageId,
      tenantId: access.tenantId,
      branchId: report.branchId,
      recipient,
      message,
      payload: JSON.stringify({ source: "cashDrawerEod", reportId: report.id, sessionId: report.sessionId }),
      createdAt: now(),
      updatedAt: now()
    });
    db.prepare(
      `UPDATE cashDrawerEodReports
          SET notificationStatus = 'queued',
              notificationRef = @notificationRef
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
    ).run({ tenantId: access.tenantId, branchId: report.branchId, id: report.id, notificationRef: messageId });
    const updated = db.prepare(
      `SELECT *
         FROM cashDrawerEodReports
        WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id`
    ).get({ tenantId: access.tenantId, branchId: report.branchId, id: report.id });
    return this.reportToApi(updated);
  }

  denominations(session) {
    return db.prepare(
      `SELECT denominationPaise, kind, qty, subtotalPaise
         FROM cashDrawerEodDenominations
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
        ORDER BY kind DESC, denominationPaise DESC`
    ).all({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id });
  }

  collections(session) {
    return db.prepare(
      `SELECT mode, autoAmountPaise, finalAmountPaise, manualAdjustmentPaise, adjustmentReason, updatedBy, updatedAt
         FROM cashDrawerEodCollections
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
        ORDER BY CASE mode WHEN 'cash' THEN 0 WHEN 'card' THEN 1 WHEN 'upi' THEN 2 ELSE 3 END, mode`
    ).all({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id });
  }

  settlements(session) {
    return db.prepare(
      `SELECT id, mode, grossPaise, settlementChargePaise, netPaise, bankRef, reconciled, settlementStatus,
              creditedAt, importBatchId, matchedInvoiceIds, updatedBy, updatedAt
         FROM cashDrawerEodSettlements
        WHERE tenantId = @tenantId AND branchId = @branchId AND sessionId = @sessionId
        ORDER BY mode`
    ).all({ tenantId: session.tenant_id, branchId: session.branch_id, sessionId: session.id });
  }

  serialize(session, access = {}) {
    const denominations = this.denominations(session);
    const collections = this.collections(session);
    const settlements = this.settlements(session);
    const operations = this.cashOperations(session);
    const operationTotals = this.operationTotals(session);
    const tillRows = this.tills(session, access);
    const handoverRows = this.handovers(session);
    const floatSuggestion = parseJson(session.nextDayFloatSuggestion, null) || this.floatSuggestionForSession(session);
    const risk = this.riskSnapshot(session, access, { persist: false });
    const blockers = this.closeBlockers(session, access, { risk });
    const blind = Number(session.blindClose || 0) === 1 && isCashier(access);
    const base = {
      id: session.id,
      tenantId: session.tenant_id,
      branchId: session.branch_id,
      businessDate: session.businessDate || "",
      status: session.status,
      openedBy: session.openedBy || session.cashier_id || "",
      openedAt: session.opened_at || "",
      closedBy: session.closedBy || "",
      closedAt: session.closed_at || "",
      notes: session.notes || "",
      blindClose: Number(session.blindClose || 0) === 1,
      denominations,
      operations,
      operationTotals,
      handovers: handoverRows,
      floatSuggestion,
      settlements,
      risk,
      canClose: blockers.length === 0,
      blockers
    };
    if (blind) {
      const hasDenoms = denominations.length > 0;
      return {
        ...base,
        collections: collections.filter((item) => item.mode !== "cash").map((item) => ({
          mode: item.mode,
          bankSettlementRequired: true
        })),
        tills: tillRows.map((row) => ({
          id: row.id,
          tillName: row.tillName,
          cashierId: row.cashierId,
          status: row.status,
          openedAt: row.openedAt,
          closedAt: row.closedAt
        })),
        blindResult: {
          matched: hasDenoms && Number(session.variancePaise || 0) === 0,
          managerApprovalRequired: hasDenoms && Number(session.variancePaise || 0) !== 0
        }
      };
    }
    return {
      ...base,
      openingBalancePaise: Number(session.openingBalancePaise || 0),
      cashCollectedPaise: Number(session.cashCollectedPaise || 0),
      cashPayoutPaise: Number(session.cashPayoutPaise || 0),
      cashOperationImpactPaise: Number(session.cashOperationImpactPaise || 0),
      cashDropPaise: Number(session.cashDropPaise || 0),
      cashPickupPaise: Number(session.cashPickupPaise || 0),
      pettyCashPayoutPaise: Number(session.pettyCashPayoutPaise || 0),
      safeMovePaise: Number(session.safeMovePaise || 0),
      expectedCashPaise: Number(session.expectedCashPaise || 0),
      countedCashPaise: Number(session.countedCashPaise || 0),
      variancePaise: Number(session.variancePaise || 0),
      varianceReason: session.varianceReason || "",
      tills: tillRows,
      collections
    };
  }

  reportToApi(row) {
    if (!row) return null;
    return {
      ...row,
      denominationBreakdown: parseJson(row.denominationBreakdown, []),
      modeWiseCollection: parseJson(row.modeWiseCollection, []),
      settlementBreakdown: parseJson(row.settlementBreakdown, []),
      tillBreakdown: parseJson(row.tillBreakdown, []),
      operationBreakdown: parseJson(row.operationBreakdown, []),
      handoverBreakdown: parseJson(row.handoverBreakdown, []),
      floatSuggestion: parseJson(row.floatSuggestion, {})
    };
  }
}

export const cashDrawerEodService = new CashDrawerEodService();
