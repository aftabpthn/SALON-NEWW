import { db } from "../db.js";
import { happyHoursCampaignLinksRepo } from "./happy-hours-campaign-links.repo.js";
import { happyHoursControlTowerRepo } from "./happy-hours-control-tower.repo.js";

const CHANNELS = new Set(["whatsapp", "sms"]);
const STATUSES = new Set(["draft", "ready", "archived"]);

const TEMPLATES = [
  {
    key: "inactive_60_days",
    name: "Inactive 60 Days",
    description: "Clients with no visit in 60+ days for win-back campaigns.",
    criteria: { inactiveDaysGte: 60, visitCountGte: 1 },
    messageHint: "Limited-time comeback offer"
  },
  {
    key: "vip_clients",
    name: "VIP Clients",
    description: "High spend, repeat clients for premium retention.",
    criteria: { totalSpendPaiseGte: 2500000, visitCountGte: 5 },
    messageHint: "Exclusive VIP perk"
  },
  {
    key: "birthday_month",
    name: "Birthday Month",
    description: "Clients whose birthday falls in the current month.",
    criteria: { birthdayMonth: "current" },
    messageHint: "Birthday month treat"
  },
  {
    key: "last_service_category",
    name: "Last Service Category",
    description: "Clients whose last service category matches the campaign.",
    criteria: { lastServiceCategory: "hair" },
    messageHint: "Repeat your last service"
  },
  {
    key: "new_clients",
    name: "New Clients",
    description: "Fresh clients for first-repeat conversion campaigns.",
    criteria: { visitCountLte: 1, createdWithinDays: 45 },
    messageHint: "Second visit invitation"
  },
  {
    key: "bridal_package_clients",
    name: "Bridal / Package Clients",
    description: "Package-ready clients for high-ticket bridal offers.",
    criteria: { serviceCategory: "bridal", totalSpendPaiseGte: 500000 },
    messageHint: "Bridal package consultation"
  },
  {
    key: "high_spend_clients",
    name: "High Spend Clients",
    description: "Strong spend history and upsell potential.",
    criteria: { totalSpendPaiseGte: 2500000 },
    messageHint: "Package upgrade offer"
  }
];

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursCampaignAudiences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    audienceKey TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    definitionJson TEXT NOT NULL DEFAULT '{}',
    offerJson TEXT NOT NULL DEFAULT '{}',
    estimateCount INTEGER NOT NULL DEFAULT 0,
    previewJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, audienceKey)
  );

  CREATE INDEX IF NOT EXISTS idx_hhCampaignAudiences_scope
    ON happyHoursCampaignAudiences(tenantId, branchId, status, createdAt);
`);

const statements = {
  upsert: db.prepare(`
    INSERT INTO happyHoursCampaignAudiences (
      tenantId, branchId, name, audienceKey, channel, definitionJson, offerJson,
      estimateCount, previewJson, status, createdBy
    )
    VALUES (
      @tenantId, @branchId, @name, @audienceKey, @channel, @definitionJson, @offerJson,
      @estimateCount, @previewJson, @status, @createdBy
    )
    ON CONFLICT(tenantId, branchId, audienceKey) DO UPDATE SET
      name = excluded.name,
      channel = excluded.channel,
      definitionJson = excluded.definitionJson,
      offerJson = excluded.offerJson,
      estimateCount = excluded.estimateCount,
      previewJson = excluded.previewJson,
      status = excluded.status,
      updatedAt = strftime('%s','now')
  `),
  list: db.prepare(`
    SELECT *
    FROM happyHoursCampaignAudiences
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND (@status = '' OR status = @status)
    ORDER BY updatedAt DESC, id DESC
    LIMIT @limit OFFSET @offset
  `),
  getById: db.prepare(`
    SELECT *
    FROM happyHoursCampaignAudiences
    WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id
  `),
  updateStatus: db.prepare(`
    UPDATE happyHoursCampaignAudiences
    SET status = @status,
        updatedAt = strftime('%s','now')
    WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id
  `)
};

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

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonText(value, fallback = {}) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value);
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
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

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function daysSince(epoch) {
  if (!epoch) return 9999;
  return Math.max(0, Math.floor((nowTs() - epoch) / 86400));
}

function monthFromDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  const match = text.match(/(?:^\d{4}[-/])?(\d{1,2})[-/]\d{1,2}/);
  if (match) return String(Number(match[1])).padStart(2, "0");
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? String(date.getMonth() + 1).padStart(2, "0") : "";
}

function currentMonth() {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "2-digit" }).format(new Date());
}

function channel(value) {
  const normalized = String(value || "whatsapp").trim().toLowerCase();
  return CHANNELS.has(normalized) ? normalized : "whatsapp";
}

function status(value, fallback = "draft") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return STATUSES.has(normalized) ? normalized : fallback;
}

function shortText(value, fallback = "", max = 180) {
  return String(value || fallback || "").trim().slice(0, max);
}

function keyText(value, fallback = "custom_audience") {
  const text = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return text || fallback;
}

function normalizeDefinition(data = {}) {
  const templateKey = keyText(data.templateKey || data.audienceKey || data.key || "custom_audience");
  const template = TEMPLATES.find((item) => item.key === templateKey);
  const rawCriteria = data.criteria || data.definition?.criteria || template?.criteria || {};
  const criteria = {};
  for (const [key, value] of Object.entries(rawCriteria)) {
    if (value === "" || value === undefined || value === null) continue;
    criteria[key] = ["inactiveDaysGte", "inactiveDaysLte", "visitCountGte", "visitCountLte", "totalSpendPaiseGte", "createdWithinDays"].includes(key)
      ? Number(value)
      : value;
  }
  return {
    templateKey,
    criteria,
    messageHint: data.messageHint || template?.messageHint || "",
    description: data.description || template?.description || ""
  };
}

function normalizeOffer(data = {}) {
  return {
    ruleId: Number.parseInt(data.ruleId, 10) || null,
    couponId: Number.parseInt(data.couponId, 10) || null,
    title: shortText(data.title, "Happy Hours campaign", 180),
    message: shortText(data.message, "", 1200),
    scheduledFor: data.scheduledFor || null
  };
}

function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    definition: parseJson(row.definitionJson, {}),
    offer: parseJson(row.offerJson, {}),
    preview: parseJson(row.previewJson, {})
  };
}

function baseClients(scope) {
  const map = new Map();
  const columns = tableColumns("clients");
  if (!columns.length) return map;
  const tenantCol = firstColumn(columns, ["tenantId", "tenant_id"]);
  const branchCol = firstColumn(columns, ["branchId", "branch_id"]);
  const idCol = firstColumn(columns, ["id", "clientId", "client_id", "customerId", "customer_id"]);
  const nameCol = firstColumn(columns, ["name", "fullName", "clientName", "customerName"]);
  const phoneCol = firstColumn(columns, ["phone", "mobile", "phoneNumber", "mobileNumber", "contactNumber"]);
  const emailCol = firstColumn(columns, ["email", "emailAddress"]);
  const birthdayCol = firstColumn(columns, ["birthday", "birthDate", "dateOfBirth", "dob"]);
  const createdCol = firstColumn(columns, ["createdAt", "created_at", "createdOn"]);
  const lastVisitCol = firstColumn(columns, ["lastVisitAt", "lastVisitDate", "last_visit_date"]);
  if (!idCol) return map;
  const where = [];
  if (tenantCol) where.push(`${q(tenantCol)} = @tenantId`);
  if (branchCol) where.push(`${q(branchCol)} = @branchId`);
  const sql = `
    SELECT ${q(idCol)} AS clientId,
           ${nameCol ? q(nameCol) : q(idCol)} AS clientName,
           ${phoneCol ? q(phoneCol) : "''"} AS phone,
           ${emailCol ? q(emailCol) : "''"} AS email,
           ${birthdayCol ? q(birthdayCol) : "''"} AS birthday,
           ${createdCol ? q(createdCol) : "''"} AS createdAt,
           ${lastVisitCol ? q(lastVisitCol) : "''"} AS lastVisitAt
    FROM clients
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    LIMIT 20000
  `;
  for (const row of rows(sql, scope)) {
    const clientId = String(row.clientId || "").trim();
    if (!clientId) continue;
    map.set(clientId, {
      clientId,
      clientName: String(row.clientName || clientId),
      phone: String(row.phone || ""),
      email: String(row.email || ""),
      birthdayMonth: monthFromDate(row.birthday),
      createdAt: toEpoch(row.createdAt),
      lastVisitAt: toEpoch(row.lastVisitAt),
      visitCount: 0,
      totalSpendPaise: 0,
      lastServiceCategory: "",
      serviceCategories: new Set()
    });
  }
  return map;
}

function ensureClient(map, clientId) {
  const key = String(clientId || "").trim();
  if (!key) return null;
  if (!map.has(key)) {
    map.set(key, {
      clientId: key,
      clientName: key,
      phone: "",
      email: "",
      birthdayMonth: "",
      createdAt: 0,
      lastVisitAt: 0,
      visitCount: 0,
      totalSpendPaise: 0,
      lastServiceCategory: "",
      serviceCategories: new Set()
    });
  }
  return map.get(key);
}

function addVisit(client, row) {
  if (!client) return;
  const eventAt = toEpoch(row.eventAt);
  const amountPaise = intPaise(row.amountPaise);
  const category = String(row.serviceCategory || "").trim();
  client.visitCount += 1;
  client.totalSpendPaise += amountPaise;
  if (eventAt && eventAt >= Number(client.lastVisitAt || 0)) {
    client.lastVisitAt = eventAt;
    if (category) client.lastServiceCategory = category;
  }
  if (category) client.serviceCategories.add(category);
}

function visitRowsFromSource(tableName, scope) {
  const columns = tableColumns(tableName);
  if (!columns.length) return [];
  const tenantCol = firstColumn(columns, ["tenantId", "tenant_id"]);
  const branchCol = firstColumn(columns, ["branchId", "branch_id"]);
  const clientCol = firstColumn(columns, ["clientId", "client_id", "customerId", "customer_id"]);
  const amountCol = firstColumn(columns, ["amountPaise", "totalPaise", "grandTotalPaise", "netTotalPaise", "totalAmountPaise", "total", "amount"]);
  const dateCol = firstColumn(columns, ["createdAt", "created_at", "invoiceDate", "appointmentDate", "date", "startAt", "startTime", "dueDate"]);
  const categoryCol = firstColumn(columns, ["serviceCategory", "category", "service_category", "lastServiceCategory"]);
  if (!tenantCol || !branchCol || !clientCol || !dateCol) return [];
  return rows(`
    SELECT ${q(clientCol)} AS clientId,
           ${amountCol ? q(amountCol) : "0"} AS amountPaise,
           ${q(dateCol)} AS eventAt,
           ${categoryCol ? q(categoryCol) : "''"} AS serviceCategory
    FROM ${q(tableName)}
    WHERE ${q(tenantCol)} = @tenantId
      AND ${q(branchCol)} = @branchId
      AND COALESCE(${q(clientCol)}, '') <> ''
    ORDER BY ${q(dateCol)} DESC
    LIMIT 20000
  `, scope);
}

function roiVisitRows(scope) {
  if (!hasColumns("offerRoiEvents", ["tenantId", "branchId", "clientId", "amountPaise", "metadata", "createdAt"])) return [];
  return rows(`
    SELECT clientId, amountPaise, metadata, createdAt
    FROM offerRoiEvents
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND COALESCE(clientId, '') <> ''
    ORDER BY createdAt DESC
    LIMIT 20000
  `, scope).map((row) => {
    const metadata = parseJson(row.metadata, {});
    return {
      clientId: row.clientId,
      amountPaise: row.amountPaise,
      eventAt: row.createdAt,
      serviceCategory: metadata.serviceCategory || metadata.category || metadata.lastServiceCategory || ""
    };
  });
}

function buildClientProfiles(scope) {
  const current = requireScope(scope);
  const map = baseClients(current);
  for (const tableName of ["invoices", "appointments", "billing"]) {
    for (const row of visitRowsFromSource(tableName, current)) {
      addVisit(ensureClient(map, row.clientId), row);
    }
  }
  for (const row of roiVisitRows(current)) {
    addVisit(ensureClient(map, row.clientId), row);
  }
  return [...map.values()].map((client) => ({
    ...client,
    serviceCategories: [...client.serviceCategories],
    inactiveDays: daysSince(client.lastVisitAt),
    createdDaysAgo: daysSince(client.createdAt),
    contact: client.phone || client.email || "",
    clientType: client.visitCount <= 1 ? "new" : "existing"
  }));
}

function matchesCriteria(client, criteria = {}) {
  if (criteria.inactiveDaysGte !== undefined && Number(client.inactiveDays || 0) < Number(criteria.inactiveDaysGte)) return false;
  if (criteria.inactiveDaysLte !== undefined && Number(client.inactiveDays || 0) > Number(criteria.inactiveDaysLte)) return false;
  if (criteria.visitCountGte !== undefined && Number(client.visitCount || 0) < Number(criteria.visitCountGte)) return false;
  if (criteria.visitCountLte !== undefined && Number(client.visitCount || 0) > Number(criteria.visitCountLte)) return false;
  if (criteria.totalSpendPaiseGte !== undefined && intPaise(client.totalSpendPaise) < intPaise(criteria.totalSpendPaiseGte)) return false;
  if (criteria.createdWithinDays !== undefined && Number(client.createdDaysAgo || 9999) > Number(criteria.createdWithinDays)) return false;
  if (criteria.birthdayMonth) {
    const month = String(criteria.birthdayMonth) === "current" ? currentMonth() : String(criteria.birthdayMonth).padStart(2, "0");
    if (client.birthdayMonth !== month) return false;
  }
  if (criteria.clientType && String(client.clientType || "") !== String(criteria.clientType)) return false;
  if (criteria.lastServiceCategory && String(client.lastServiceCategory || "").toLowerCase() !== String(criteria.lastServiceCategory).toLowerCase()) return false;
  if (criteria.serviceCategory && !client.serviceCategories.map((item) => item.toLowerCase()).includes(String(criteria.serviceCategory).toLowerCase())) return false;
  return true;
}

function defaultMessage(data, definition, estimateCount) {
  if (data.message) return shortText(data.message, "", 1200);
  const title = data.title || definition.messageHint || "Happy Hours offer";
  return `Hi {{name}}, ${title} is ready for you at Aura. This audience has ${estimateCount} eligible client(s). Reply or book now before the offer expires.`;
}

function previewPayload(data = {}) {
  const current = requireScope(data);
  const definition = normalizeDefinition(data);
  const offer = normalizeOffer(data);
  const channelValue = channel(data.channel);
  const clients = buildClientProfiles(current).filter((client) => matchesCriteria(client, definition.criteria));
  const sample = clients.slice(0, Math.min(100, Math.max(10, Number.parseInt(data.previewLimit, 10) || 50)));
  return {
    ...current,
    name: shortText(data.name, TEMPLATES.find((item) => item.key === definition.templateKey)?.name || "Custom Audience"),
    audienceKey: keyText(data.audienceKey || definition.templateKey),
    channel: channelValue,
    definition,
    offer: {
      ...offer,
      message: defaultMessage({ ...data, ...offer }, definition, clients.length)
    },
    estimateCount: clients.length,
    sample,
    target: {
      audienceKey: keyText(data.audienceKey || definition.templateKey),
      audienceLabel: shortText(data.audienceLabel, data.name || definition.templateKey, 120),
      estimateCount: clients.length,
      sampleClientIds: sample.map((client) => client.clientId),
      criteria: definition.criteria,
      channel: channelValue,
      manualReviewRequired: true
    },
    warnings: [
      "Audience preview never sends messages automatically.",
      "Optional source tables are skipped safely if unavailable.",
      "Final campaign send still needs manual approval."
    ]
  };
}

function normalizeSavePayload(data = {}) {
  const preview = previewPayload(data);
  return {
    ...preview,
    definitionJson: jsonText(preview.definition),
    offerJson: jsonText(preview.offer),
    previewJson: jsonText({ target: preview.target, sample: preview.sample.slice(0, 25), warnings: preview.warnings }),
    status: status(data.status, "draft"),
    createdBy: data.createdBy || null
  };
}

export function templates() {
  return { rows: TEMPLATES };
}

export function preview(data = {}) {
  return previewPayload(data);
}

export function save(data = {}) {
  const payload = normalizeSavePayload(data);
  statements.upsert.run(payload);
  const row = db.prepare(`
    SELECT *
    FROM happyHoursCampaignAudiences
    WHERE tenantId = @tenantId AND branchId = @branchId AND audienceKey = @audienceKey
    LIMIT 1
  `).get(payload);
  return parseRow(row);
}

export function list(scope = {}) {
  const current = requireScope(scope);
  const params = {
    ...current,
    status: STATUSES.has(String(scope.status || "")) ? String(scope.status) : "",
    limit: Math.min(200, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
  return { rows: statements.list.all(params).map(parseRow), limit: params.limit, offset: params.offset };
}

export function updateStatus(scope = {}) {
  const current = requireScope(scope);
  const id = Number.parseInt(scope.id, 10);
  if (!id) throw new Error("valid audience id is required");
  statements.updateStatus.run({ ...current, id, status: status(scope.status) });
  return parseRow(statements.getById.get({ ...current, id }));
}

export function createDraft(data = {}) {
  const audience = save({ ...data, status: data.status || "ready" });
  const previewData = {
    ...data,
    name: audience.name,
    audienceKey: audience.audienceKey,
    criteria: audience.definition?.criteria || {},
    channel: audience.channel,
    title: audience.offer?.title,
    message: audience.offer?.message,
    ruleId: audience.offer?.ruleId,
    couponId: audience.offer?.couponId
  };
  const previewResult = preview(previewData);
  const draftTarget = {
    ...previewResult.target,
    source: "campaign_audience_builder",
    audienceId: audience.id
  };
  const draftInput = {
    ...requireScope(data),
    ruleId: audience.offer?.ruleId,
    couponId: audience.offer?.couponId,
    title: audience.offer?.title || audience.name,
    message: audience.offer?.message || previewResult.offer.message,
    segment: audience.audienceKey,
    audienceLabel: audience.name,
    target: draftTarget,
    channel: audience.channel,
    scheduledFor: audience.offer?.scheduledFor || null,
    createdBy: data.createdBy || null
  };

  if (draftInput.ruleId) {
    return {
      audience,
      preview: previewResult,
      draft: happyHoursCampaignLinksRepo.createCampaignDraftFromRule(draftInput)
    };
  }

  if (audience.channel === "whatsapp") {
    return {
      audience,
      preview: previewResult,
      draft: {
        whatsappDraft: happyHoursControlTowerRepo.saveWhatsappDraft({
          ...draftInput,
          status: "draft"
        })
      }
    };
  }

  return {
    audience,
    preview: previewResult,
    draft: {
      smsManualDraft: {
        title: draftInput.title,
        message: draftInput.message,
        target: draftTarget,
        status: "draft"
      }
    }
  };
}

export const happyHoursCampaignAudiencesRepo = {
  templates,
  preview,
  save,
  list,
  updateStatus,
  createDraft
};
