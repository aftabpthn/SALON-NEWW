import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;

export const APPOINTMENT_ACTIVITY_ACTIONS = {
  BOOKED: "BOOKED",
  MODIFIED: "MODIFIED",
  RESCHEDULED: "RESCHEDULED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
  COMPLETED: "COMPLETED",
  ARRIVED: "ARRIVED",
  STARTED: "STARTED",
  BILLED: "BILLED",
  DUPLICATED: "DUPLICATED",
  STATUS_CHANGED: "STATUS_CHANGED",
  DELETED: "DELETED"
};

const ACTION_GROUPS = {
  BOOKED: "booking",
  DUPLICATED: "booking",
  MODIFIED: "change",
  RESCHEDULED: "change",
  STATUS_CHANGED: "change",
  ARRIVED: "service",
  STARTED: "service",
  COMPLETED: "service",
  BILLED: "billing",
  CANCELLED: "cancellation",
  NO_SHOW: "cancellation",
  DELETED: "cancellation"
};

const CHANGE_FIELDS = [
  ["status", "Status"],
  ["startAt", "Start time"],
  ["endAt", "End time"],
  ["staffId", "Staff"],
  ["branchId", "Branch"],
  ["clientId", "Client"],
  ["serviceIds", "Services"],
  ["chair", "Chair"],
  ["room", "Room"],
  ["sourceChannel", "Source"],
  ["depositStatus", "Deposit"],
  ["notes", "Notes"]
];

function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {}, "appointments");
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value ?? parseJson(fallback, {}));
  } catch {
    return fallback;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function normalizeAction(action) {
  const upper = String(action || "").trim().toUpperCase().replace(/[-\s]+/g, "_");
  return APPOINTMENT_ACTIVITY_ACTIONS[upper] ? upper : APPOINTMENT_ACTIVITY_ACTIONS.MODIFIED;
}

function normalizeServiceIds(value) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      const parsed = parseJson(trimmed, []);
      return Array.isArray(parsed) ? parsed.map((item) => text(item)).filter(Boolean) : [];
    }
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function fieldValue(record = {}, key) {
  const value = record?.[key];
  if (key === "serviceIds") return normalizeServiceIds(value).join(", ");
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return stringify(value, "{}");
  return String(value);
}

function appointmentSnapshot(record = {}) {
  if (!record) return {};
  return {
    id: record.id || "",
    clientId: record.clientId || "",
    staffId: record.staffId || "",
    branchId: record.branchId || "",
    serviceIds: normalizeServiceIds(record.serviceIds || record.serviceIdsJson || record.services),
    startAt: record.startAt || "",
    endAt: record.endAt || "",
    status: record.status || "",
    chair: record.chair || record.chairId || "",
    room: record.room || record.roomId || "",
    source: record.source || "",
    sourceChannel: record.sourceChannel || record.source || "",
    depositStatus: record.depositStatus || "",
    notes: record.notes || "",
    version: record.version || 1
  };
}

function buildChanges(oldData = {}, newData = {}, explicitChanges = []) {
  if (Array.isArray(explicitChanges) && explicitChanges.length) {
    return explicitChanges.map((change) => ({
      field: text(change.field || change.label || "Field"),
      oldValue: text(change.oldValue ?? change.before ?? "-") || "-",
      newValue: text(change.newValue ?? change.after ?? "-") || "-",
      category: text(change.category || "Appointment")
    }));
  }
  const oldSnapshot = appointmentSnapshot(oldData);
  const newSnapshot = appointmentSnapshot(newData);
  return CHANGE_FIELDS.map(([key, label]) => ({
    field: label,
    oldValue: fieldValue(oldSnapshot, key),
    newValue: fieldValue(newSnapshot, key),
    category: key === "status" ? "Lifecycle" : key === "startAt" || key === "endAt" || key === "staffId" ? "Schedule" : "Appointment"
  })).filter((change) => change.oldValue !== change.newValue);
}

function classifyUpdate(oldData = {}, newData = {}, explicitAction = "") {
  if (explicitAction) return normalizeAction(explicitAction);
  const oldStatus = text(oldData.status).toLowerCase();
  const nextStatus = text(newData.status).toLowerCase();
  if (nextStatus && nextStatus !== oldStatus) {
    if (nextStatus === "cancelled") return APPOINTMENT_ACTIVITY_ACTIONS.CANCELLED;
    if (nextStatus === "no-show") return APPOINTMENT_ACTIVITY_ACTIONS.NO_SHOW;
    if (nextStatus === "completed") return APPOINTMENT_ACTIVITY_ACTIONS.COMPLETED;
    if (nextStatus === "arrived") return APPOINTMENT_ACTIVITY_ACTIONS.ARRIVED;
    if (nextStatus === "in-service") return APPOINTMENT_ACTIVITY_ACTIONS.STARTED;
    if (["billed", "paid"].includes(nextStatus)) return APPOINTMENT_ACTIVITY_ACTIONS.BILLED;
  }
  const moved = ["startAt", "endAt", "staffId", "branchId", "chair", "room"].some((key) => fieldValue(oldData, key) !== fieldValue(newData, key));
  if (moved) return APPOINTMENT_ACTIVITY_ACTIONS.RESCHEDULED;
  return APPOINTMENT_ACTIVITY_ACTIONS.MODIFIED;
}

function serviceValue(record = {}) {
  return normalizeServiceIds(record.serviceIds || record.serviceIdsJson || record.services)
    .reduce((sum, serviceId) => sum + Number(repositories.services.getById(serviceId)?.price || 0), 0);
}

function riskLevel(score) {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function suggestedActionFor(level, action) {
  if (level === "critical") return "Manager must review before accepting the next booking. Ask for deposit or owner approval.";
  if (level === "high") return action === "NO_SHOW"
    ? "Send no-show recovery, require confirmation and consider deposit on next visit."
    : "Call client, capture reason and monitor repeated schedule changes.";
  if (level === "medium") return "Confirm upcoming appointment by WhatsApp and watch for repeated changes.";
  return "No special action needed beyond routine front-desk follow-up.";
}

function riskFor({ action, appointment = {}, oldData = {}, newData = {}, changes = [], reason = "", access }) {
  const clientId = text(newData.clientId || oldData.clientId || appointment.clientId);
  const staffId = text(newData.staffId || oldData.staffId || appointment.staffId);
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const repeated = clientId
    ? db.prepare(
      `SELECT
        SUM(CASE WHEN action = 'CANCELLED' THEN 1 ELSE 0 END) AS cancellations,
        SUM(CASE WHEN action = 'RESCHEDULED' THEN 1 ELSE 0 END) AS reschedules,
        SUM(CASE WHEN action = 'NO_SHOW' THEN 1 ELSE 0 END) AS noShows
       FROM appointment_activity_log
       WHERE tenantId = @tenantId AND clientId = @clientId AND createdAt >= @since`
    ).get({ tenantId: access.tenantId, clientId, since })
    : { cancellations: 0, reschedules: 0, noShows: 0 };
  const staffChanges = staffId
    ? db.prepare(
      `SELECT COUNT(*) AS count
       FROM appointment_activity_log
       WHERE tenantId = @tenantId AND staffId = @staffId AND action IN ('MODIFIED', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW') AND createdAt >= @since`
    ).get({ tenantId: access.tenantId, staffId, since })?.count || 0
    : 0;

  let score = 10;
  const reasons = [];
  const currentValue = Math.max(serviceValue(newData), serviceValue(oldData), serviceValue(appointment));
  const start = new Date(newData.startAt || oldData.startAt || appointment.startAt || Date.now()).getTime();
  const hoursBeforeStart = (start - Date.now()) / 36e5;

  if (action === "CANCELLED") {
    score += 25;
    reasons.push("Appointment cancelled.");
    if (hoursBeforeStart <= 24) {
      score += 25;
      reasons.push("Late cancellation inside 24 hours.");
    }
    if (number(repeated.cancellations) + 1 >= 3) {
      score += 25;
      reasons.push("Client has repeated cancellations in the last 90 days.");
    }
  }
  if (action === "RESCHEDULED") {
    score += 18;
    reasons.push("Appointment rescheduled.");
    if (number(repeated.reschedules) + 1 >= 3) {
      score += 25;
      reasons.push("Client repeatedly reschedules appointments.");
    }
  }
  if (action === "NO_SHOW") {
    score += 45;
    reasons.push("No-show recorded.");
    if (number(repeated.noShows) + 1 >= 2) {
      score += 35;
      reasons.push("Repeated no-show pattern found.");
    }
  }
  if (currentValue >= 5000 && ["CANCELLED", "NO_SHOW", "RESCHEDULED"].includes(action)) {
    score += 15;
    reasons.push("High-value appointment affected.");
  }
  if (staffChanges >= 10) {
    score += 12;
    reasons.push("Same staff member has a high volume of recent appointment changes.");
  }
  if (changes.length >= 5) {
    score += 8;
    reasons.push("Multiple appointment fields changed together.");
  }
  if (reason && /refund|angry|complaint|late|emergency|mistake/i.test(reason)) {
    score += 8;
    reasons.push("Reason contains a sensitive service recovery signal.");
  }

  score = Math.max(5, Math.min(100, score));
  const level = riskLevel(score);
  return {
    riskScore: score,
    riskLevel: level,
    riskReasons: reasons.length ? reasons : ["Routine appointment activity."],
    suggestedAction: suggestedActionFor(level, action)
  };
}

function enrichRow(row) {
  const oldData = parseJson(row.oldData, {});
  const newData = parseJson(row.newData, {});
  const changes = parseJson(row.changes, []);
  const riskReasons = parseJson(row.riskReasons, []);
  const appointment = repositories.appointments.getById(row.appointmentId, { tenantId: row.tenantId }) || {};
  const client = row.clientId ? repositories.clients.getById(row.clientId, { tenantId: row.tenantId }) : null;
  const staff = row.staffId ? repositories.staff.getById(row.staffId, { tenantId: row.tenantId }) : null;
  const branch = row.branchId ? repositories.branches.getById(row.branchId, { tenantId: row.tenantId }) : null;
  return {
    ...row,
    oldData,
    newData,
    changes,
    riskReasons,
    riskReason: riskReasons[0] || "Routine appointment activity.",
    clientName: client?.name || newData.clientName || oldData.clientName || "Unknown client",
    clientPhone: client?.phone || client?.mobile || "",
    staffName: staff?.name || newData.staffName || oldData.staffName || "Unassigned",
    branchName: branch?.name || row.branchId || "",
    appointmentStartAt: appointment.startAt || newData.startAt || oldData.startAt || "",
    appointmentEndAt: appointment.endAt || newData.endAt || oldData.endAt || "",
    appointmentStatus: appointment.status || row.statusAfter || row.statusBefore || "",
    serviceNames: normalizeServiceIds(appointment.serviceIds || newData.serviceIds || oldData.serviceIds)
      .map((id) => repositories.services.getById(id)?.name || id)
      .join(", ")
  };
}

function buildWhere(query = {}, access = {}) {
  const where = ["tenantId = @tenantId"];
  const params = { tenantId: access.tenantId };
  if (query.branchId) {
    tenantService.assertBranchAccess(access, query.branchId);
    where.push("branchId = @branchId");
    params.branchId = query.branchId;
  } else if (access.branchId && (["staff", "frontDesk"].includes(access.role) || access.requestedBranchId)) {
    where.push("branchId = @accessBranchId");
    params.accessBranchId = access.branchId;
  }
  if (query.clientId) {
    where.push("clientId = @clientId");
    params.clientId = query.clientId;
  }
  if (query.appointmentId) {
    where.push("appointmentId = @appointmentId");
    params.appointmentId = query.appointmentId;
  }
  if (query.staffId) {
    where.push("staffId = @staffId");
    params.staffId = query.staffId;
  }
  if (query.action) {
    where.push("action = @action");
    params.action = normalizeAction(query.action);
  }
  if (query.riskLevel) {
    where.push("riskLevel = @riskLevel");
    params.riskLevel = String(query.riskLevel).toLowerCase();
  }
  if (query.from) {
    where.push("createdAt >= @from");
    params.from = new Date(query.from).toISOString();
  }
  if (query.to) {
    const end = new Date(query.to);
    if (String(query.to).length <= 10) end.setHours(23, 59, 59, 999);
    where.push("createdAt <= @to");
    params.to = end.toISOString();
  }
  return { where, params };
}

function appointmentDate(value = "") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function appointmentWithinFilters(appointment = {}, query = {}) {
  const startAt = appointmentDate(appointment.startAt || appointment.createdAt);
  if (query.from) {
    const from = new Date(`${String(query.from).slice(0, 10)}T00:00:00.000Z`).getTime();
    if (startAt < from) return false;
  }
  if (query.to) {
    const to = new Date(`${String(query.to).slice(0, 10)}T23:59:59.999Z`).getTime();
    if (startAt > to) return false;
  }
  if (query.clientId && appointment.clientId !== query.clientId) return false;
  if (query.staffId && appointment.staffId !== query.staffId) return false;
  if (query.status && String(appointment.status || "").toLowerCase() !== String(query.status).toLowerCase()) return false;
  return true;
}

function paymentStatusFor(invoice = {}) {
  if (!invoice?.id) return "not_billed";
  const total = money(invoice.total ?? invoice.grandTotal ?? invoice.grand_total);
  const paid = money(invoice.paid ?? invoice.paidAmount ?? invoice.paid_amount);
  const balance = money(invoice.balance ?? invoice.dueAmount ?? invoice.due_amount ?? total - paid);
  if (balance <= 0) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

function registerProblemFlags({ appointment = {}, invoice = {}, timeline = [] } = {}) {
  const flags = [];
  const status = String(appointment.status || "").toLowerCase();
  if (["completed", "billed", "paid"].includes(status) && !invoice?.id) flags.push("Completed but invoice missing");
  if (["cancelled", "canceled", "no-show"].includes(status)) {
    const hasReason = timeline.some((row) => row.reason) || appointment.cancelReason || appointment.cancellationReason || appointment.reason;
    if (!hasReason) flags.push("Cancelled without reason");
  }
  if (invoice?.id && money(invoice.balance ?? invoice.dueAmount ?? invoice.due_amount) > 0) flags.push("Payment pending");
  if (!timeline.length) flags.push("No activity timeline");
  return flags;
}

function messageStatusFor(appointmentId, messageRows = []) {
  const rows = messageRows.filter((row) => {
    const payload = parseJson(row.payload, {});
    return payload.appointmentId === appointmentId;
  });
  if (!rows.length) return { status: "not_sent", count: 0, latestAt: "" };
  const latest = rows.sort((a, b) => appointmentDate(b.createdAt) - appointmentDate(a.createdAt))[0];
  return { status: latest.status || "queued", count: rows.length, latestAt: latest.createdAt || "" };
}

function appointmentSource(appointment = {}, firstActivity = {}) {
  return text(appointment.sourceChannel || appointment.source || firstActivity.source || "manual");
}

export const appointmentActivityService = {
  classifyUpdate,

  logActivity({ action = "", appointment = {}, oldData = {}, newData = {}, reason = "", source = "", access = {}, req = null, changes = [] } = {}) {
    const resolvedAction = normalizeAction(action || classifyUpdate(oldData, newData));
    const before = appointmentSnapshot(oldData);
    const after = appointmentSnapshot({ ...oldData, ...appointment, ...newData });
    const appointmentId = text(after.id || before.id || appointment.id || newData.id || oldData.id);
    if (!appointmentId) throw badRequest("appointmentId is required for appointment activity");
    const branchId = text(after.branchId || before.branchId || access.branchId);
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const rowChanges = buildChanges(before, after, changes);
    const risk = riskFor({
      action: resolvedAction,
      appointment,
      oldData: before,
      newData: after,
      changes: rowChanges,
      reason,
      access
    });
    const row = {
      id: makeId("apptact"),
      tenantId: access.tenantId,
      branchId,
      appointmentId,
      clientId: text(after.clientId || before.clientId),
      staffId: text(after.staffId || before.staffId),
      action: resolvedAction,
      actionGroup: ACTION_GROUPS[resolvedAction] || "change",
      statusBefore: text(before.status),
      statusAfter: text(after.status),
      changedBy: access.userId || req?.user?.id || "system",
      changedByRole: access.role || "system",
      source: source || after.sourceChannel || after.source || "system",
      reason: text(reason),
      oldData: stringify(before),
      newData: stringify(after),
      changes: stringify(rowChanges, "[]"),
      riskLevel: risk.riskLevel,
      riskScore: risk.riskScore,
      riskReasons: stringify(risk.riskReasons, "[]"),
      suggestedAction: risk.suggestedAction,
      createdAt: now(),
      version: 1
    };
    db.prepare(
      `INSERT INTO appointment_activity_log (
        id, tenantId, branchId, appointmentId, clientId, staffId, action, actionGroup,
        statusBefore, statusAfter, changedBy, changedByRole, source, reason,
        oldData, newData, changes, riskLevel, riskScore, riskReasons, suggestedAction, createdAt, version
      ) VALUES (
        @id, @tenantId, @branchId, @appointmentId, @clientId, @staffId, @action, @actionGroup,
        @statusBefore, @statusAfter, @changedBy, @changedByRole, @source, @reason,
        @oldData, @newData, @changes, @riskLevel, @riskScore, @riskReasons, @suggestedAction, @createdAt, @version
      )`
    ).run(row);
    return enrichRow(row);
  },

  list(query = {}, access = {}) {
    const { where, params } = buildWhere(query, access);
    const q = text(query.q || query.search).toLowerCase();
    const limit = Math.min(Math.max(Number(query.limit || 100), 1), 1000);
    const rows = db.prepare(
      `SELECT * FROM appointment_activity_log
       WHERE ${where.join(" AND ")}
       ORDER BY createdAt DESC
       LIMIT @limit`
    ).all({ ...params, limit }).map(enrichRow);
    if (!q) return rows;
    return rows.filter((row) => [
      row.appointmentId,
      row.clientId,
      row.clientName,
      row.clientPhone,
      row.staffName,
      row.branchName,
      row.action,
      row.reason,
      row.riskReason
    ].join(" ").toLowerCase().includes(q));
  },

  get(id, access = {}) {
    const row = db.prepare("SELECT * FROM appointment_activity_log WHERE tenantId = ? AND id = ?").get(access.tenantId, id);
    if (!row) throw notFound("Appointment activity not found");
    if (row.branchId) tenantService.assertBranchAccess(access, row.branchId);
    return enrichRow(row);
  },

  appointmentTimeline(appointmentId, access = {}) {
    const appointment = repositories.appointments.getById(appointmentId, scope(access));
    if (!appointment) throw notFound("Appointment not found");
    if (appointment.branchId) tenantService.assertBranchAccess(access, appointment.branchId);
    return this.list({ appointmentId, limit: 500 }, access).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  clientHistory(clientId, query = {}, access = {}) {
    const client = repositories.clients.getById(clientId, tenantService.accessScope(access, "clients"));
    if (!client) throw notFound("Client not found");
    if (client.branchId) tenantService.assertBranchAccess(access, client.branchId);
    const timeline = this.list({ ...query, clientId, limit: query.limit || 500 }, access);
    const stats = reliabilityStats(timeline);
    return {
      client,
      stats,
      reliability: reliabilityFromStats(stats),
      timeline,
      suggestions: reliabilitySuggestions(stats)
    };
  },

  reports(query = {}, access = {}) {
    const rows = this.list({ ...query, limit: query.limit || 1000 }, access);
    const daily = new Map();
    const staff = new Map();
    const clients = new Map();
    const reasons = new Map();
    for (const row of rows) {
      const day = String(row.createdAt || "").slice(0, 10);
      const dailyRow = daily.get(day) || { date: day, total: 0, cancellations: 0, reschedules: 0, noShows: 0, highRisk: 0 };
      dailyRow.total += 1;
      if (row.action === "CANCELLED") dailyRow.cancellations += 1;
      if (row.action === "RESCHEDULED") dailyRow.reschedules += 1;
      if (row.action === "NO_SHOW") dailyRow.noShows += 1;
      if (["high", "critical"].includes(row.riskLevel)) dailyRow.highRisk += 1;
      daily.set(day, dailyRow);

      const staffKey = row.staffId || "unassigned";
      const staffRow = staff.get(staffKey) || { staffId: staffKey, staffName: row.staffName, changes: 0, cancellations: 0, reschedules: 0, noShows: 0, riskScore: 0 };
      staffRow.changes += 1;
      staffRow.riskScore = Math.max(staffRow.riskScore, row.riskScore || 0);
      if (row.action === "CANCELLED") staffRow.cancellations += 1;
      if (row.action === "RESCHEDULED") staffRow.reschedules += 1;
      if (row.action === "NO_SHOW") staffRow.noShows += 1;
      staff.set(staffKey, staffRow);

      const clientKey = row.clientId || "unknown";
      const clientRow = clients.get(clientKey) || { clientId: clientKey, clientName: row.clientName, clientPhone: row.clientPhone, total: 0, cancellations: 0, reschedules: 0, noShows: 0, riskScore: 0 };
      clientRow.total += 1;
      clientRow.riskScore = Math.max(clientRow.riskScore, row.riskScore || 0);
      if (row.action === "CANCELLED") clientRow.cancellations += 1;
      if (row.action === "RESCHEDULED") clientRow.reschedules += 1;
      if (row.action === "NO_SHOW") clientRow.noShows += 1;
      clients.set(clientKey, clientRow);

      if (row.reason && ["CANCELLED", "RESCHEDULED", "NO_SHOW"].includes(row.action)) {
        const reasonRow = reasons.get(row.reason) || { reason: row.reason, count: 0 };
        reasonRow.count += 1;
        reasons.set(row.reason, reasonRow);
      }
    }
    return {
      generatedAt: now(),
      summary: {
        totalActivities: rows.length,
        cancellations: rows.filter((row) => row.action === "CANCELLED").length,
        reschedules: rows.filter((row) => row.action === "RESCHEDULED").length,
        noShows: rows.filter((row) => row.action === "NO_SHOW").length,
        completed: rows.filter((row) => row.action === "COMPLETED").length,
        highRiskActivities: rows.filter((row) => ["high", "critical"].includes(row.riskLevel)).length,
        criticalActivities: rows.filter((row) => row.riskLevel === "critical").length
      },
      dailySummary: [...daily.values()].sort((a, b) => b.date.localeCompare(a.date)),
      staffRisk: [...staff.values()].sort((a, b) => b.riskScore - a.riskScore || b.changes - a.changes),
      clientReliability: [...clients.values()].map((item) => ({
        ...item,
        reliabilityScore: reliabilityFromStats(item).score,
        riskLevel: reliabilityFromStats(item).riskLevel
      })).sort((a, b) => a.reliabilityScore - b.reliabilityScore),
      cancellationReasons: [...reasons.values()].sort((a, b) => b.count - a.count),
      exportRows: rows.map((row) => ({
        createdAt: row.createdAt,
        appointmentId: row.appointmentId,
        clientName: row.clientName,
        clientPhone: row.clientPhone,
        staffName: row.staffName,
        branchName: row.branchName,
        action: row.action,
        reason: row.reason,
        statusBefore: row.statusBefore,
        statusAfter: row.statusAfter,
        riskLevel: row.riskLevel,
        riskScore: row.riskScore,
        riskReason: row.riskReason,
        suggestedAction: row.suggestedAction
      }))
    };
  },

  register(query = {}, access = {}) {
    const branchId = query.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const appointmentScope = scope(access, branchId);
    const appointments = repositories.appointments
      .list({ branchId, limit: Math.min(Math.max(Number(query.limit || 1000), 1), 5000) }, appointmentScope)
      .filter((appointment) => appointmentWithinFilters(appointment, query));
    const activityRows = this.list({ branchId, limit: 5000 }, access);
    const activitiesByAppointment = new Map();
    for (const activity of activityRows) {
      const rows = activitiesByAppointment.get(activity.appointmentId) || [];
      rows.push(activity);
      activitiesByAppointment.set(activity.appointmentId, rows);
    }
    const invoiceScope = tenantService.accessScope(access || {}, "invoices");
    if (branchId) invoiceScope.branchId = branchId;
    const salesScope = tenantService.accessScope(access || {}, "sales");
    if (branchId) salesScope.branchId = branchId;
    const invoices = repositories.invoices.list({ branchId, limit: 5000 }, invoiceScope);
    const sales = repositories.sales.list({ branchId, limit: 5000 }, salesScope);
    const saleById = new Map(sales.map((sale) => [sale.id, sale]));
    const invoiceByAppointment = new Map();
    for (const invoice of invoices) {
      const directAppointmentId = text(invoice.appointmentId || invoice.appointment_id);
      const saleAppointmentId = text(saleById.get(invoice.saleId)?.appointmentId || saleById.get(invoice.saleId)?.appointment_id);
      const appointmentId = directAppointmentId || saleAppointmentId;
      if (appointmentId && !invoiceByAppointment.has(appointmentId)) invoiceByAppointment.set(appointmentId, invoice);
    }
    const messageScope = tenantService.accessScope(access || {}, "messageLogs");
    if (branchId) messageScope.branchId = branchId;
    const messageRows = repositories.messageLogs.list({ branchId, limit: 5000 }, messageScope);

    let rows = appointments.map((appointment) => {
      const timeline = (activitiesByAppointment.get(appointment.id) || []).sort((a, b) => appointmentDate(a.createdAt) - appointmentDate(b.createdAt));
      const firstActivity = timeline[0] || {};
      const latestActivity = timeline[timeline.length - 1] || {};
      const client = appointment.clientId ? repositories.clients.getById(appointment.clientId, { tenantId: access.tenantId }) : null;
      const staff = appointment.staffId ? repositories.staff.getById(appointment.staffId, { tenantId: access.tenantId }) : null;
      const branch = appointment.branchId ? repositories.branches.getById(appointment.branchId, { tenantId: access.tenantId }) : null;
      const invoice = invoiceByAppointment.get(appointment.id) || {};
      const serviceNames = normalizeServiceIds(appointment.serviceIds)
        .map((id) => repositories.services.getById(id)?.name || id)
        .join(", ");
      const total = money(invoice.total ?? invoice.grandTotal ?? invoice.grand_total);
      const paid = money(invoice.paid ?? invoice.paidAmount ?? invoice.paid_amount);
      const balance = money(invoice.balance ?? invoice.dueAmount ?? invoice.due_amount ?? total - paid);
      return {
        id: appointment.id,
        appointmentId: appointment.id,
        bookingGroupId: appointment.bookingGroupId || "",
        clientId: appointment.clientId || "",
        clientName: client?.name || firstActivity.clientName || "Unknown client",
        clientPhone: client?.phone || client?.mobile || firstActivity.clientPhone || "",
        branchId: appointment.branchId || "",
        branchName: branch?.name || appointment.branchId || "",
        staffId: appointment.staffId || "",
        staffName: staff?.name || latestActivity.staffName || firstActivity.staffName || "Unassigned",
        bookingMode: appointmentSource(appointment, firstActivity),
        bookedAt: firstActivity.action === "BOOKED" ? firstActivity.createdAt : appointment.createdAt || firstActivity.createdAt || "",
        appointmentStartAt: appointment.startAt || "",
        appointmentEndAt: appointment.endAt || "",
        durationMinutes: Math.max(0, Math.round((appointmentDate(appointment.endAt) - appointmentDate(appointment.startAt)) / 60000)) || Number(appointment.durationMinutes || 0),
        serviceNames,
        status: appointment.status || latestActivity.statusAfter || "",
        cancelReason: timeline.find((row) => ["CANCELLED", "NO_SHOW"].includes(row.action) && row.reason)?.reason || appointment.cancelReason || appointment.cancellationReason || "",
        notes: appointment.notes || latestActivity.newData?.notes || firstActivity.newData?.notes || "",
        createdBy: firstActivity.changedBy || appointment.createdBy || "system",
        lastUpdatedBy: latestActivity.changedBy || appointment.updatedBy || "system",
        lastUpdatedAt: appointment.updatedAt || latestActivity.createdAt || "",
        invoiceId: invoice.id || "",
        invoiceNumber: invoice.invoiceNumber || invoice.invoice_no || "",
        total,
        paid,
        balance,
        paymentStatus: paymentStatusFor(invoice),
        invoiceStatus: invoice.status || "",
        messageStatus: messageStatusFor(appointment.id, messageRows),
        timeline,
        timelineCount: timeline.length,
        problemFlags: registerProblemFlags({ appointment, invoice, timeline })
      };
    });
    const q = text(query.q || query.search).toLowerCase();
    if (q) {
      rows = rows.filter((row) => [
        row.appointmentId,
        row.clientName,
        row.clientPhone,
        row.staffName,
        row.serviceNames,
        row.bookingMode,
        row.status,
        row.invoiceNumber,
        row.cancelReason,
        row.problemFlags.join(" ")
      ].join(" ").toLowerCase().includes(q));
    }
    if (query.paymentStatus) rows = rows.filter((row) => row.paymentStatus === query.paymentStatus);
    return {
      generatedAt: now(),
      summary: {
        totalAppointments: rows.length,
        completed: rows.filter((row) => ["completed", "billed", "paid"].includes(String(row.status).toLowerCase())).length,
        cancelled: rows.filter((row) => ["cancelled", "canceled", "no-show"].includes(String(row.status).toLowerCase())).length,
        pending: rows.filter((row) => !["completed", "billed", "paid", "cancelled", "canceled", "no-show", "deleted"].includes(String(row.status).toLowerCase())).length,
        billedAmount: rows.reduce((sum, row) => sum + row.total, 0),
        unpaidAmount: rows.reduce((sum, row) => sum + row.balance, 0),
        problemCount: rows.filter((row) => row.problemFlags.length).length
      },
      rows: rows.sort((a, b) => appointmentDate(b.appointmentStartAt || b.bookedAt) - appointmentDate(a.appointmentStartAt || a.bookedAt))
    };
  }
};

function reliabilityStats(timeline = []) {
  return {
    totalActivities: timeline.length,
    totalAppointments: new Set(timeline.map((row) => row.appointmentId).filter(Boolean)).size,
    booked: timeline.filter((row) => ["BOOKED", "DUPLICATED"].includes(row.action)).length,
    completed: timeline.filter((row) => row.action === "COMPLETED").length,
    cancellations: timeline.filter((row) => row.action === "CANCELLED").length,
    reschedules: timeline.filter((row) => row.action === "RESCHEDULED").length,
    noShows: timeline.filter((row) => row.action === "NO_SHOW").length,
    highRiskActivities: timeline.filter((row) => ["high", "critical"].includes(row.riskLevel)).length
  };
}

function reliabilityFromStats(stats = {}) {
  const total = Math.max(1, Number(stats.totalAppointments || stats.total || stats.totalActivities || 0));
  const intensity = Math.max(1, Math.min(2, total / 4));
  const penalty = (
    Number(stats.cancellations || 0) * 12
    + Number(stats.noShows || 0) * 24
    + Number(stats.reschedules || 0) * 6
    + Number(stats.highRiskActivities || 0) * 5
  ) * intensity;
  const reward = Math.min(18, Number(stats.completed || 0) * 3);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty + reward)));
  const risk = score < 45 ? "critical" : score < 65 ? "high" : score < 82 ? "medium" : "low";
  return {
    score,
    riskLevel: risk,
    label: score >= 82 ? "Reliable" : score >= 65 ? "Watch" : score >= 45 ? "Risky" : "Critical"
  };
}

function reliabilitySuggestions(stats = {}) {
  const suggestions = [];
  if (Number(stats.noShows || 0) > 0) suggestions.push("Require confirmation before assigning premium slots.");
  if (Number(stats.cancellations || 0) >= 2) suggestions.push("Capture cancellation reason and request deposit for peak-hour bookings.");
  if (Number(stats.reschedules || 0) >= 3) suggestions.push("Offer shorter-duration slots or flexible staff options.");
  if (!suggestions.length) suggestions.push("Client can continue with normal booking confirmation.");
  return suggestions;
}
