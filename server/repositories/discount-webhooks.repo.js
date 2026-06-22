import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS discountWebhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    eventsJson TEXT NOT NULL DEFAULT '[]',
    secret TEXT NOT NULL DEFAULT '',
    headersJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS webhookDeliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    webhookId INTEGER NOT NULL,
    eventType TEXT NOT NULL,
    eventKey TEXT NOT NULL,
    payloadJson TEXT NOT NULL DEFAULT '{}',
    signature TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    responseStatus INTEGER DEFAULT NULL,
    responseBody TEXT NOT NULL DEFAULT '',
    errorMessage TEXT NOT NULL DEFAULT '',
    nextRetryAt INTEGER DEFAULT NULL,
    deliveredAt INTEGER DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(webhookId, eventKey)
  );

  CREATE INDEX IF NOT EXISTS idx_discountWebhooks_scope ON discountWebhooks(tenantId, branchId, status);
  CREATE INDEX IF NOT EXISTS idx_discountWebhooks_events ON discountWebhooks(tenantId, branchId, status, updatedAt);
  CREATE INDEX IF NOT EXISTS idx_webhookDeliveries_scope ON webhookDeliveries(tenantId, branchId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_webhookDeliveries_webhook ON webhookDeliveries(webhookId, createdAt);
`);

const statuses = new Set(["active", "paused", "disabled"]);
const deliveryStatuses = new Set(["pending", "delivered", "failed"]);

const statements = {
  insertWebhook: db.prepare(`
    INSERT INTO discountWebhooks (tenantId, branchId, name, url, eventsJson, secret, headersJson, status, createdBy)
    VALUES (@tenantId, @branchId, @name, @url, @eventsJson, @secret, @headersJson, @status, @createdBy)
  `),
  updateWebhook: db.prepare(`
    UPDATE discountWebhooks
    SET name = @name,
        url = @url,
        eventsJson = @eventsJson,
        secret = @secret,
        headersJson = @headersJson,
        status = @status,
        updatedAt = strftime('%s','now')
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
  `),
  getWebhook: db.prepare(`
    SELECT * FROM discountWebhooks
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
    LIMIT 1
  `),
  listWebhooks: db.prepare(`
    SELECT * FROM discountWebhooks
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND (@status IS NULL OR status = @status)
    ORDER BY updatedAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `),
  activeWebhooks: db.prepare(`
    SELECT * FROM discountWebhooks
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
    ORDER BY id ASC
  `),
  upsertDelivery: db.prepare(`
    INSERT INTO webhookDeliveries (
      tenantId, branchId, webhookId, eventType, eventKey, payloadJson, signature,
      status, attempts, responseStatus, responseBody, errorMessage, nextRetryAt, deliveredAt
    )
    VALUES (
      @tenantId, @branchId, @webhookId, @eventType, @eventKey, @payloadJson, @signature,
      @status, @attempts, @responseStatus, @responseBody, @errorMessage, @nextRetryAt, @deliveredAt
    )
    ON CONFLICT(webhookId, eventKey)
    DO UPDATE SET
      payloadJson = excluded.payloadJson,
      signature = excluded.signature,
      status = excluded.status,
      attempts = webhookDeliveries.attempts + excluded.attempts,
      responseStatus = excluded.responseStatus,
      responseBody = excluded.responseBody,
      errorMessage = excluded.errorMessage,
      nextRetryAt = excluded.nextRetryAt,
      deliveredAt = excluded.deliveredAt,
      updatedAt = strftime('%s','now')
  `),
  getDeliveryByKey: db.prepare(`
    SELECT * FROM webhookDeliveries
    WHERE webhookId = @webhookId
      AND eventKey = @eventKey
    LIMIT 1
  `),
  listDeliveries: db.prepare(`
    SELECT d.*, w.name AS webhookName, w.url AS webhookUrl
    FROM webhookDeliveries d
    LEFT JOIN discountWebhooks w ON w.id = d.webhookId
    WHERE d.tenantId = @tenantId
      AND d.branchId = @branchId
      AND (@webhookId IS NULL OR d.webhookId = @webhookId)
      AND (@eventType IS NULL OR d.eventType = @eventType)
      AND (@status IS NULL OR d.status = @status)
    ORDER BY d.createdAt DESC, d.id DESC
    LIMIT @limit OFFSET @offset
  `)
};

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
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

function normalizeStatus(value) {
  const status = String(value || "active").trim();
  return statuses.has(status) ? status : "active";
}

function normalizeDeliveryStatus(value) {
  const status = String(value || "pending").trim();
  return deliveryStatuses.has(status) ? status : "pending";
}

function normalizeEvents(value) {
  const events = Array.isArray(value) ? value : parseJson(value, []);
  return [...new Set(events.map((event) => String(event || "").trim()).filter(Boolean))];
}

function normalizeUrl(value) {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("url must start with http:// or https://");
  return url;
}

function normalizeWebhook(data = {}, existing = {}) {
  const name = data.name === undefined ? existing.name : String(data.name || "").trim();
  if (!name) throw new Error("name is required");
  const events = data.events === undefined && data.eventsJson === undefined
    ? parseJson(existing.eventsJson, [])
    : normalizeEvents(data.events ?? data.eventsJson);
  return {
    ...requireScope(data),
    id: Number.parseInt(data.id, 10) || null,
    name,
    url: data.url === undefined ? existing.url : normalizeUrl(data.url),
    eventsJson: JSON.stringify(events.length ? events : ["*"]),
    secret: data.secret === undefined ? String(existing.secret || "") : String(data.secret || ""),
    headersJson: data.headers === undefined && data.headersJson === undefined
      ? existing.headersJson || "{}"
      : jsonText(data.headers ?? data.headersJson, {}),
    status: normalizeStatus(data.status === undefined ? existing.status : data.status),
    createdBy: data.createdBy || existing.createdBy || null
  };
}

function parseWebhook(row) {
  if (!row) return null;
  return {
    ...row,
    events: parseJson(row.eventsJson, []),
    headers: parseJson(row.headersJson, {})
  };
}

function parseDelivery(row) {
  if (!row) return null;
  return {
    ...row,
    payload: parseJson(row.payloadJson, {})
  };
}

export function registerWebhook(data = {}) {
  const payload = normalizeWebhook(data);
  const result = statements.insertWebhook.run(payload);
  return parseWebhook(statements.getWebhook.get({ ...payload, id: Number(result.lastInsertRowid) }));
}

export function listWebhooks(scope = {}) {
  const current = requireScope(scope);
  const status = scope.status ? normalizeStatus(scope.status) : null;
  const limit = Math.min(100, Math.max(1, Number.parseInt(scope.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(scope.offset, 10) || 0);
  return {
    rows: statements.listWebhooks.all({ ...current, status, limit, offset }).map(parseWebhook),
    limit,
    offset
  };
}

export function updateWebhook(data = {}) {
  const current = requireScope(data);
  const id = Number.parseInt(data.id, 10) || 0;
  const existing = statements.getWebhook.get({ ...current, id });
  if (!existing) throw new Error("webhook not found");
  const payload = normalizeWebhook({ ...data, id }, existing);
  statements.updateWebhook.run(payload);
  return parseWebhook(statements.getWebhook.get({ ...current, id }));
}

export function matchingWebhooks(scope = {}) {
  const current = requireScope(scope);
  const eventType = String(scope.eventType || "").trim();
  return statements.activeWebhooks.all(current)
    .map(parseWebhook)
    .filter((webhook) => webhook.events.includes("*") || webhook.events.includes(eventType));
}

export function recordDelivery(data = {}) {
  const current = requireScope(data);
  const payload = {
    ...current,
    webhookId: Number.parseInt(data.webhookId, 10) || 0,
    eventType: String(data.eventType || "").trim(),
    eventKey: String(data.eventKey || "").trim(),
    payloadJson: jsonText(data.payload ?? data.payloadJson, {}),
    signature: String(data.signature || ""),
    status: normalizeDeliveryStatus(data.status),
    attempts: Math.max(0, Number.parseInt(data.attempts, 10) || 0),
    responseStatus: data.responseStatus === undefined || data.responseStatus === null ? null : Number.parseInt(data.responseStatus, 10) || 0,
    responseBody: String(data.responseBody || "").slice(0, 2000),
    errorMessage: String(data.errorMessage || "").slice(0, 1000),
    nextRetryAt: data.nextRetryAt || null,
    deliveredAt: data.deliveredAt || null
  };
  if (!payload.webhookId) throw new Error("webhookId is required");
  if (!payload.eventType) throw new Error("eventType is required");
  if (!payload.eventKey) throw new Error("eventKey is required");
  statements.upsertDelivery.run(payload);
  return parseDelivery(statements.getDeliveryByKey.get({
    webhookId: payload.webhookId,
    eventKey: payload.eventKey
  }));
}

export function listDeliveries(scope = {}) {
  const current = requireScope(scope);
  const webhookId = scope.webhookId ? Number.parseInt(scope.webhookId, 10) || null : null;
  const eventType = scope.eventType ? String(scope.eventType).trim() : null;
  const status = scope.status ? normalizeDeliveryStatus(scope.status) : null;
  const limit = Math.min(200, Math.max(1, Number.parseInt(scope.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(scope.offset, 10) || 0);
  return {
    rows: statements.listDeliveries.all({ ...current, webhookId, eventType, status, limit, offset }).map(parseDelivery),
    limit,
    offset
  };
}

export const discountWebhooksRepo = {
  registerWebhook,
  listWebhooks,
  updateWebhook,
  recordDelivery,
  listDeliveries,
  matchingWebhooks
};
