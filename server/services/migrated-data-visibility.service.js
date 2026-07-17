import { columnsFor, db, deserialize } from "../db.js";
import { notFound } from "../utils/app-error.js";
import { tenantService } from "./tenant.service.js";

const TABLES = new Set(["appointments", "clients", "invoices", "memberships", "payments", "sales", "wallet_transactions"]);

function numberParam(value, fallback, max) {
  const parsed = Number(value);
  return Math.min(max, Math.max(1, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback));
}

function branchFrom(query, access) {
  const branchId = String(query.branchId || access.requestedBranchId || access.branchId || "");
  if (branchId) tenantService.assertBranchAccess(access, branchId);
  return branchId;
}

function parsed(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function tableRows(table, access, branchId, predicate, params = {}, limit = 2000) {
  if (!TABLES.has(table)) return [];
  const columns = columnsFor(table);
  const where = ["tenantId = @tenantId", predicate];
  const values = { tenantId: access.tenantId, ...params, limit };
  if (branchId && columns.includes("branchId")) {
    where.push("branchId = @branchId");
    values.branchId = branchId;
  }
  const orderBy = columns.includes("createdAt") ? "createdAt DESC" : columns.includes("startAt") ? "startAt DESC" : "id DESC";
  return db.prepare(`SELECT * FROM ${table} WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT @limit`).all(values).map((row) => deserialize(table, row));
}

function clientFor(clientId, access, branchId) {
  const params = { tenantId: access.tenantId, clientId };
  const branchSql = branchId ? " AND branchId = @branchId" : "";
  const client = db.prepare(`SELECT * FROM clients WHERE tenantId = @tenantId AND id = @clientId${branchSql}`).get(branchId ? { ...params, branchId } : params);
  if (!client) throw notFound("Client not found in the selected branch");
  return deserialize("clients", client);
}

export const migratedDataVisibilityService = {
  services(query, access) {
    const branchId = branchFrom(query, access);
    const page = numberParam(query.page, 1, 10000);
    const limit = numberParam(query.limit, 50, 100);
    const offset = (page - 1) * limit;
    const q = String(query.q || "").trim();
    const params = { tenantId: access.tenantId, q: `%${q}%`, limit, offset };
    const where = ["tenantId = @tenantId", "(@q = '%%' OR name LIKE @q OR category LIKE @q OR status LIKE @q)"];
    if (branchId && columnsFor("services").includes("branchId")) {
      where.push("(branchId = @branchId OR branchId = '')");
      params.branchId = branchId;
    }
    const whereSql = where.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS count FROM services WHERE ${whereSql}`).get(params).count;
    const rows = db.prepare(`SELECT * FROM services WHERE ${whereSql} ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT @limit OFFSET @offset`).all(params).map((row) => deserialize("services", row));
    return { rows, total, page, limit, hasMore: offset + rows.length < total };
  },

  clientRelated(clientId, query, access) {
    const branchId = branchFrom(query, access);
    const client = clientFor(clientId, access, branchId);
    const invoices = tableRows("invoices", access, branchId, "clientId = @clientId", { clientId });
    const invoiceIds = invoices.map((row) => String(row.id || "")).filter(Boolean);
    let payments = [];
    if (invoiceIds.length) {
      const placeholders = invoiceIds.map((_, index) => `@invoice${index}`).join(", ");
      const params = Object.fromEntries(invoiceIds.map((id, index) => [`invoice${index}`, id]));
      payments = tableRows("payments", access, branchId, `invoiceId IN (${placeholders})`, params);
    }
    const consentParams = { tenantId: access.tenantId, clientId };
    const consentBranchSql = branchId ? " AND branchId = @branchId" : "";
    const communicationConsents = db.prepare(
      `SELECT * FROM client_communication_consents WHERE tenantId = @tenantId AND clientId = @clientId${consentBranchSql} ORDER BY updatedAt DESC`
    ).all(branchId ? { ...consentParams, branchId } : consentParams).map((row) => ({ ...row, raw: parsed(row.raw, {}) }));
    return {
      client,
      communicationConsents,
      invoices,
      payments,
      appointments: tableRows("appointments", access, branchId, "clientId = @clientId", { clientId }),
      walletTransactions: tableRows("wallet_transactions", access, branchId, "clientId = @clientId", { clientId }),
      memberships: tableRows("memberships", access, branchId, "clientId = @clientId", { clientId })
    };
  },

  clientServiceHistory(clientId, query, access) {
    const branchId = branchFrom(query, access);
    clientFor(clientId, access, branchId);
    const page = numberParam(query.page, 1, 100000);
    const limit = numberParam(query.limit, 40, 100);
    const offset = (page - 1) * limit;
    const params = { tenantId: access.tenantId, clientId, limit, offset };
    const where = ["tenantId = @tenantId", "clientId = @clientId"];
    if (branchId && columnsFor("sales").includes("branchId")) {
      where.push("branchId = @branchId");
      params.branchId = branchId;
    }
    const whereSql = where.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS count FROM sales WHERE ${whereSql}`).get(params).count;
    const sales = db.prepare(`SELECT * FROM sales WHERE ${whereSql} ORDER BY createdAt DESC, id DESC LIMIT @limit OFFSET @offset`).all(params).map((row) => deserialize("sales", row));
    const serviceHistoryTimeline = sales.map((sale) => ({
      id: `sale-${sale.id}`,
      type: "purchase",
      title: sale.invoiceNumber || `Sale ${sale.id}`,
      body: (Array.isArray(sale.items) ? sale.items : []).map((item) => item.name || item.serviceName || item.productName || "Item").join(", "),
      createdAt: sale.createdAt,
      metadata: { saleId: sale.id }
    }));
    return { sales, serviceHistoryTimeline, timelineMeta: { total, returned: sales.length, page, limit, hasMore: offset + sales.length < total } };
  },

  productMovements(productId, query, access) {
    const branchId = branchFrom(query, access);
    const page = numberParam(query.page, 1, 100000);
    const limit = numberParam(query.limit, 30, 100);
    const offset = (page - 1) * limit;
    const params = { tenantId: access.tenantId, productId, limit, offset };
    const where = ["tenantId = @tenantId", "productId = @productId"];
    if (branchId) {
      where.push("branchId = @branchId");
      params.branchId = branchId;
    }
    const whereSql = where.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS count FROM inventory_transactions WHERE ${whereSql}`).get(params).count;
    const rows = db.prepare(`SELECT * FROM inventory_transactions WHERE ${whereSql} ORDER BY createdAt DESC, id DESC LIMIT @limit OFFSET @offset`).all(params).map((row) => deserialize("inventory_transactions", row));
    return { rows, total, page, limit, hasMore: offset + rows.length < total };
  },

  membershipClientLabels(query, access) {
    const branchId = branchFrom(query, access);
    const params = { tenantId: access.tenantId };
    const branchSql = branchId ? " AND m.branchId = @branchId" : "";
    if (branchId) params.branchId = branchId;
    return db.prepare(
      `SELECT DISTINCT c.id, c.name, c.phone, c.email, c.branchId
       FROM memberships m
       JOIN clients c ON c.tenantId = m.tenantId AND c.id = m.clientId
       WHERE m.tenantId = @tenantId${branchSql}
       ORDER BY c.name COLLATE NOCASE ASC`
    ).all(params);
  },

  giftCard(cardId, query, access) {
    const branchId = branchFrom(query, access);
    const params = { tenantId: access.tenantId, cardId };
    const branchSql = branchId ? " AND branchId = @branchId" : "";
    if (branchId) params.branchId = branchId;
    const card = db.prepare(`SELECT * FROM gift_cards WHERE tenantId = @tenantId AND (id = @cardId OR code = @cardId)${branchSql}`).get(params);
    if (!card) throw notFound("Gift card not found in the selected branch");
    const transactionParams = { tenantId: access.tenantId, cardId: card.id, limit: numberParam(query.limit, 50, 100) };
    const transactionBranchSql = branchId ? " AND branchId = @branchId" : "";
    if (branchId) transactionParams.branchId = branchId;
    const transactions = db.prepare(
      `SELECT id, gift_card_id AS giftCardId, invoice_id AS invoiceId, type, amount, amountPaise,
              balance_after AS balanceAfter, balanceAfterPaise, description, created_by AS createdBy,
              created_at AS createdAt, originalSystem, originalRecordId
       FROM gift_card_transactions
       WHERE tenant_id = @tenantId AND gift_card_id = @cardId${transactionBranchSql}
       ORDER BY created_at DESC, id DESC LIMIT @limit`
    ).all(transactionParams);
    return { card: deserialize("gift_cards", card), transactions };
  },

  stagingRows(jobId, query, access) {
    const branchId = branchFrom(query, access);
    const page = numberParam(query.page, 1, 100000);
    const limit = numberParam(query.limit, 25, 100);
    const offset = (page - 1) * limit;
    const status = String(query.status || "").trim();
    const params = { tenantId: access.tenantId, jobId, status, limit, offset };
    const where = ["tenantId = @tenantId", "jobId = @jobId", "(@status = '' OR status = @status)"];
    if (branchId) {
      where.push("branchId = @branchId");
      params.branchId = branchId;
    }
    const whereSql = where.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS count FROM migration_staging_rows WHERE ${whereSql}`).get(params).count;
    const rows = db.prepare(`SELECT * FROM migration_staging_rows WHERE ${whereSql} ORDER BY sourceRowNumber ASC, id ASC LIMIT @limit OFFSET @offset`).all(params).map((row) => ({
      ...row,
      payload: parsed(row.payload, {}),
      raw: parsed(row.raw, {}),
      errors: parsed(row.errors, []),
      warnings: parsed(row.warnings, [])
    }));
    return { rows, total, page, limit, hasMore: offset + rows.length < total };
  }
};
