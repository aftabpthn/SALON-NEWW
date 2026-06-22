import { db } from "../db.js";

const STATUSES = new Set(["returned", "pending", "at_risk", "unknown_client"]);

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function tableExists(tableName) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
  } catch {
    return false;
  }
}

function tableColumns(tableName) {
  if (!tableExists(tableName)) return [];
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  } catch {
    return [];
  }
}

function hasColumns(tableName, columns) {
  const available = new Set(tableColumns(tableName));
  return columns.every((column) => available.has(column));
}

function q(column) {
  return `"${String(column).replace(/"/g, '""')}"`;
}

function firstColumn(columns, names) {
  return names.find((name) => columns.includes(name)) || "";
}

function rows(sql, params = {}) {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function idFrom(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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

function toEpoch(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return value > 100000000000 ? Math.floor(value / 1000) : Math.floor(value);
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    return number > 100000000000 ? Math.floor(number / 1000) : Math.floor(number);
  }
  const date = new Date(text.length <= 10 ? `${text.slice(0, 10)}T00:00:00+05:30` : text);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : 0;
}

function normalize(scope = {}) {
  const current = requireScope(scope);
  const returnWindowDays = Math.min(180, Math.max(1, Number.parseInt(scope.returnWindowDays, 10) || 30));
  return {
    ...current,
    from: scope.from || "",
    to: scope.to || "",
    fromTs: epochStart(scope.from),
    toTs: epochEnd(scope.to),
    status: STATUSES.has(String(scope.status || "")) ? String(scope.status) : "",
    offerType: String(scope.offerType || "").trim(),
    returnWindowDays,
    returnWindowSeconds: returnWindowDays * 86400,
    nowTs: Math.floor(Date.now() / 1000),
    limit: Math.min(500, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
}

function offerKey(row = {}) {
  const couponId = idFrom(row.couponId || row.metadata?.couponId);
  const ruleId = idFrom(row.ruleId || row.metadata?.ruleId);
  if (couponId) return `coupon:${couponId}`;
  if (ruleId) return `rule:${ruleId}`;
  return "unattributed";
}

function offerType(key) {
  if (key.startsWith("coupon:")) return "coupon";
  if (key.startsWith("rule:")) return "rule";
  return "unattributed";
}

function offerId(key) {
  return key.includes(":") ? key.split(":")[1] : "";
}

function offerTitles(tenantId) {
  const map = new Map();
  if (hasColumns("discountRules", ["tenantId", "id", "name"])) {
    for (const row of rows("SELECT id, name FROM discountRules WHERE tenantId = @tenantId", { tenantId })) {
      map.set(`rule:${row.id}`, row.name || `Rule #${row.id}`);
    }
  }
  if (hasColumns("discountCoupons", ["tenantId", "id", "code", "title"])) {
    for (const row of rows("SELECT id, code, title FROM discountCoupons WHERE tenantId = @tenantId", { tenantId })) {
      map.set(`coupon:${row.id}`, [row.code, row.title].filter(Boolean).join(" - ") || `Coupon #${row.id}`);
    }
  }
  map.set("unattributed", "Unattributed discount");
  return map;
}

function clientNames(scope) {
  const map = new Map();
  const columns = tableColumns("clients");
  if (!columns.length) return map;
  const tenantCol = firstColumn(columns, ["tenantId", "tenant_id"]);
  const branchCol = firstColumn(columns, ["branchId", "branch_id"]);
  const idCol = firstColumn(columns, ["id", "clientId", "client_id", "customerId", "customer_id"]);
  const nameCol = firstColumn(columns, ["name", "fullName", "clientName", "customerName"]);
  if (!idCol) return map;
  const where = [];
  if (tenantCol) where.push(`${q(tenantCol)} = @tenantId`);
  if (branchCol) where.push(`${q(branchCol)} = @branchId`);
  const sql = `
    SELECT ${q(idCol)} AS clientId, ${nameCol ? q(nameCol) : q(idCol)} AS clientName
    FROM clients
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    LIMIT 10000
  `;
  for (const row of rows(sql, scope)) {
    map.set(String(row.clientId), String(row.clientName || row.clientId));
  }
  return map;
}

function roiOfferEvents(filters) {
  if (!hasColumns("offerRoiEvents", ["tenantId", "branchId", "createdAt", "amountPaise", "discountPaise"])) return [];
  return rows(`
    SELECT id, ruleId, couponId, clientId, invoiceId, amountPaise, discountPaise, grossMarginPaise,
           repeatClient, source, metadata, createdAt
    FROM offerRoiEvents
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
    ORDER BY createdAt DESC, id DESC
    LIMIT 5000
  `, filters).map((row) => ({ ...row, sourceTable: "offerRoiEvents", metadata: parseJson(row.metadata, {}) }));
}

function auditOfferEvents(filters) {
  if (!hasColumns("discountAuditLog", ["tenantId", "branchId", "eventType", "createdAt", "amountPaise", "discountPaise", "metadata"])) return [];
  return rows(`
    SELECT id, ruleId, amountPaise, discountPaise, metadata, createdAt
    FROM discountAuditLog
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND eventType = 'discount_applied'
      AND createdAt >= @fromTs
      AND createdAt <= @toTs
    ORDER BY createdAt DESC, id DESC
    LIMIT 5000
  `, filters).map((row) => ({ ...row, sourceTable: "discountAuditLog", metadata: parseJson(row.metadata, {}) }));
}

function offerEvents(filters) {
  const roiRows = roiOfferEvents(filters);
  const sourceRows = roiRows.length ? roiRows : auditOfferEvents(filters);
  return sourceRows.map((row) => {
    const metadata = row.metadata || {};
    const key = offerKey({ ...row, metadata });
    return {
      sourceTable: row.sourceTable,
      sourceId: String(row.id || ""),
      offerKey: key,
      offerType: offerType(key),
      offerId: offerId(key),
      clientId: String(row.clientId || metadata.clientId || "").trim(),
      invoiceId: String(row.invoiceId || metadata.invoiceId || "").trim(),
      usedAt: Number(row.createdAt || 0),
      amountPaise: intPaise(row.amountPaise),
      discountPaise: intPaise(row.discountPaise),
      grossMarginPaise: intPaise(row.grossMarginPaise || metadata.grossMarginPaise),
      repeatClientAtUse: Boolean(row.repeatClient || metadata.repeatClient)
    };
  });
}

function visitRowsFromTable(tableName, filters) {
  const columns = tableColumns(tableName);
  if (!columns.length) return [];
  const tenantCol = firstColumn(columns, ["tenantId", "tenant_id"]);
  const branchCol = firstColumn(columns, ["branchId", "branch_id"]);
  const clientCol = firstColumn(columns, ["clientId", "client_id", "customerId", "customer_id"]);
  const idCol = firstColumn(columns, ["id", "invoiceId", "appointmentId"]);
  const amountCol = firstColumn(columns, ["amountPaise", "totalPaise", "grandTotalPaise", "netTotalPaise", "totalAmountPaise", "total", "amount"]);
  const dateCol = firstColumn(columns, ["createdAt", "created_at", "invoiceDate", "appointmentDate", "date", "startAt", "startTime", "dueDate"]);
  if (!tenantCol || !branchCol || !clientCol || !dateCol) return [];
  const sql = `
    SELECT ${idCol ? q(idCol) : "''"} AS sourceId,
           ${q(clientCol)} AS clientId,
           ${amountCol ? q(amountCol) : "0"} AS amountPaise,
           ${q(dateCol)} AS eventAt
    FROM ${q(tableName)}
    WHERE ${q(tenantCol)} = @tenantId
      AND ${q(branchCol)} = @branchId
      AND COALESCE(${q(clientCol)}, '') <> ''
    ORDER BY ${q(dateCol)} ASC
    LIMIT 20000
  `;
  return rows(sql, filters).map((row) => ({
    source: tableName,
    sourceId: String(row.sourceId || ""),
    clientId: String(row.clientId || "").trim(),
    amountPaise: intPaise(row.amountPaise),
    eventAt: toEpoch(row.eventAt)
  })).filter((row) => row.eventAt > 0);
}

function visitRows(filters) {
  const lowerBound = Math.max(0, filters.fromTs - 86400);
  const upperBound = filters.toTs + filters.returnWindowSeconds;
  const seen = new Set();
  const result = [];
  for (const tableName of ["invoices", "appointments", "billing"]) {
    for (const row of visitRowsFromTable(tableName, filters)) {
      if (row.eventAt < lowerBound || row.eventAt > upperBound) continue;
      const key = `${row.source}:${row.sourceId}:${row.clientId}:${row.eventAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(row);
    }
  }
  return result.sort((left, right) => left.eventAt - right.eventAt);
}

function firstReturnFor(event, visits, filters) {
  if (!event.clientId) return null;
  const after = event.usedAt + 60;
  const before = event.usedAt + filters.returnWindowSeconds;
  return visits.find((visit) => {
    if (visit.clientId !== event.clientId) return false;
    if (event.invoiceId && visit.sourceId && String(visit.sourceId) === String(event.invoiceId)) return false;
    return visit.eventAt > after && visit.eventAt <= before;
  }) || null;
}

function statusFor(event, returned, filters) {
  if (!event.clientId) return "unknown_client";
  if (returned) return "returned";
  return filters.nowTs > event.usedAt + filters.returnWindowSeconds ? "at_risk" : "pending";
}

function actionFor(status) {
  if (status === "returned") return "Keep offer nurture active.";
  if (status === "pending") return "Wait until return window closes.";
  if (status === "at_risk") return "Create retention follow-up or lower-risk offer.";
  return "Capture clientId on discount usage.";
}

function build(scope = {}) {
  const filters = normalize(scope);
  const titles = offerTitles(filters.tenantId);
  const names = clientNames(filters);
  const visits = visitRows(filters);
  const events = offerEvents(filters);
  const rowsData = events.map((event) => {
    const returned = firstReturnFor(event, visits, filters);
    const status = statusFor(event, returned, filters);
    const daysToReturn = returned ? Math.max(0, Math.ceil((returned.eventAt - event.usedAt) / 86400)) : null;
    return {
      ...event,
      clientName: names.get(event.clientId) || event.clientId || "Unknown client",
      offerTitle: titles.get(event.offerKey) || event.offerKey,
      status,
      returned: status === "returned",
      returnAt: returned?.eventAt || null,
      returnSource: returned?.source || "",
      returnSourceId: returned?.sourceId || "",
      returnAmountPaise: intPaise(returned?.amountPaise),
      daysToReturn,
      recommendation: actionFor(status)
    };
  });
  return { filters, rows: rowsData };
}

function filteredRows(scope = {}) {
  const result = build(scope);
  const rowsData = result.rows.filter((row) => {
    if (result.filters.status && row.status !== result.filters.status) return false;
    if (result.filters.offerType && row.offerType !== result.filters.offerType) return false;
    return true;
  }).sort((left, right) => {
    const priority = { at_risk: 0, pending: 1, returned: 2, unknown_client: 3 };
    return (priority[left.status] ?? 4) - (priority[right.status] ?? 4) || right.usedAt - left.usedAt;
  });
  return { ...result, rows: rowsData };
}

function aggregateOffers(rowsData) {
  const byOffer = new Map();
  for (const row of rowsData) {
    const item = byOffer.get(row.offerKey) || {
      offerKey: row.offerKey,
      offerType: row.offerType,
      offerId: row.offerId,
      offerTitle: row.offerTitle,
      offerUses: 0,
      returnedCount: 0,
      atRiskCount: 0,
      pendingCount: 0,
      unknownClientCount: 0,
      discountPaise: 0,
      returnRevenuePaise: 0,
      daysTotal: 0
    };
    item.offerUses += 1;
    item.discountPaise += row.discountPaise;
    item.returnRevenuePaise += row.returnAmountPaise;
    if (row.status === "returned") {
      item.returnedCount += 1;
      item.daysTotal += Number(row.daysToReturn || 0);
    } else if (row.status === "at_risk") {
      item.atRiskCount += 1;
    } else if (row.status === "pending") {
      item.pendingCount += 1;
    } else if (row.status === "unknown_client") {
      item.unknownClientCount += 1;
    }
    byOffer.set(row.offerKey, item);
  }
  return [...byOffer.values()].map((row) => ({
    ...row,
    returnRatePercent: row.offerUses ? Math.round((row.returnedCount * 10000) / row.offerUses) / 100 : 0,
    avgDaysToReturn: row.returnedCount ? Math.round((row.daysTotal * 10) / row.returnedCount) / 10 : 0
  })).sort((left, right) => right.returnRatePercent - left.returnRatePercent || right.returnRevenuePaise - left.returnRevenuePaise);
}

export function clients(scope = {}) {
  const result = filteredRows(scope);
  const { limit, offset } = result.filters;
  return {
    ...result.filters,
    rows: result.rows.slice(offset, offset + limit),
    total: result.rows.length,
    limit,
    offset
  };
}

export function offers(scope = {}) {
  const result = filteredRows(scope);
  const offerRows = aggregateOffers(result.rows);
  return {
    ...result.filters,
    rows: offerRows.slice(0, result.filters.limit),
    total: offerRows.length
  };
}

export function summary(scope = {}) {
  const result = build(scope);
  const rowsData = result.rows;
  const returnedRows = rowsData.filter((row) => row.status === "returned");
  const uniqueClients = new Set(rowsData.map((row) => row.clientId).filter(Boolean));
  const returnedClients = new Set(returnedRows.map((row) => row.clientId).filter(Boolean));
  const totals = rowsData.reduce((acc, row) => {
    acc.offerUses += 1;
    acc.discountPaise += row.discountPaise;
    acc.offerRevenuePaise += row.amountPaise;
    acc.returnRevenuePaise += row.returnAmountPaise;
    acc.returnedCount += row.status === "returned" ? 1 : 0;
    acc.pendingCount += row.status === "pending" ? 1 : 0;
    acc.atRiskCount += row.status === "at_risk" ? 1 : 0;
    acc.unknownClientCount += row.status === "unknown_client" ? 1 : 0;
    acc.daysTotal += row.status === "returned" ? Number(row.daysToReturn || 0) : 0;
    return acc;
  }, {
    offerUses: 0,
    discountPaise: 0,
    offerRevenuePaise: 0,
    returnRevenuePaise: 0,
    returnedCount: 0,
    pendingCount: 0,
    atRiskCount: 0,
    unknownClientCount: 0,
    daysTotal: 0
  });
  return {
    ...result.filters,
    summary: {
      ...totals,
      uniqueClients: uniqueClients.size,
      returnedClients: returnedClients.size,
      returnRatePercent: totals.offerUses ? Math.round((totals.returnedCount * 10000) / totals.offerUses) / 100 : 0,
      avgDaysToReturn: totals.returnedCount ? Math.round((totals.daysTotal * 10) / totals.returnedCount) / 10 : 0,
      returnRevenuePerDiscountPercent: totals.discountPaise ? Math.round((totals.returnRevenuePaise * 10000) / totals.discountPaise) / 100 : 0
    },
    topOffers: aggregateOffers(rowsData).slice(0, 5),
    atRiskClients: rowsData.filter((row) => row.status === "at_risk").slice(0, 10),
    pendingClients: rowsData.filter((row) => row.status === "pending").slice(0, 5),
    note: "Client return tracking uses Happy Hours outcome rows plus optional invoices, appointments or billing visits. Missing optional sources are skipped safely."
  };
}

export const happyHoursClientReturnTrackerRepo = {
  summary,
  clients,
  offers
};
