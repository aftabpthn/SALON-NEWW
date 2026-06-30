import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { ensureMessageTemplateStudioSchema } from "./message-template-studio-schema.service.js";

const CHANNELS = new Set(["sms", "whatsapp", "email"]);
const AUDIENCES = new Set(["client", "admin", "staff"]);

const SAMPLE_VALUES = {
  Name: "SWATI GUPTA",
  "Salon Name": "Aura Salon",
  Price: "₹1,500",
  Balance: "₹740",
  Date: "30-06-2026",
  Time: "05:30 PM",
  Service: "Hair Spa",
  Staff: "Aftab Pathan",
  "Invoice No": "AURA-2026-00847",
  Link: "https://pay.example/aura",
  Points: "250",
  Package: "Hair Spa Pack",
  Giftcard: "GC-1024",
  OTP: "123456"
};

const EVENT_CATALOG = [
  ["client", "quick_sale", "Quick Sale", ["sms", "whatsapp", "email"], "Hi {{Name}}, thank you for visiting {{Salon Name}}. Your bill {{Invoice No}} amount is {{Price}}."],
  ["client", "appointment_confirmed", "Appointment Confirmed", ["sms", "whatsapp", "email"], "Hi {{Name}}, your {{Service}} appointment is confirmed on {{Date}} at {{Time}} with {{Staff}}."],
  ["client", "appointment_reschedule", "Appointment Reschedule", ["sms", "whatsapp"], "Hi {{Name}}, your appointment has been rescheduled to {{Date}} at {{Time}}."],
  ["client", "appointment_cancelled", "Appointment Cancelled", ["sms", "whatsapp"], "Hi {{Name}}, your appointment at {{Salon Name}} was cancelled. Reply to book again."],
  ["client", "birthday_anniversary", "Birthday / Anniversary", ["sms", "whatsapp"], "Hi {{Name}}, {{Salon Name}} wishes you a special day. Visit us soon for your benefit."],
  ["client", "pending_due_payment", "Pending / Due Payment", ["sms", "whatsapp"], "Hi {{Name}}, your pending balance is {{Balance}} for {{Invoice No}}. Pay here: {{Link}}."],
  ["client", "pending_services_package", "Pending Services / Package", ["sms", "whatsapp"], "Hi {{Name}}, your {{Package}} has services pending. Book soon at {{Salon Name}}."],
  ["client", "giftcard", "Giftcard", ["sms", "whatsapp"], "Hi {{Name}}, your gift card {{Giftcard}} is active with {{Balance}} balance."],
  ["client", "ewallet", "Ewallet", ["sms", "whatsapp"], "Hi {{Name}}, your eWallet balance is {{Balance}} at {{Salon Name}}."],
  ["client", "rewards", "Rewards", ["sms", "whatsapp"], "Hi {{Name}}, you have {{Points}} reward points available at {{Salon Name}}."],
  ["client", "otp", "OTP", ["sms", "whatsapp"], "Your {{Salon Name}} OTP is {{OTP}}. Do not share it with anyone."],
  ["client", "consent_form", "Consent Form", ["sms", "whatsapp", "email"], "Hi {{Name}}, please complete your consent form here: {{Link}}."],
  ["admin", "online_appointment", "Online Appointment", ["sms", "whatsapp", "email"], "New online appointment: {{Name}} for {{Service}} on {{Date}} at {{Time}}."],
  ["admin", "manual_appointment", "Manual Appointment", ["sms", "whatsapp", "email"], "Manual appointment added: {{Name}} for {{Service}} on {{Date}} at {{Time}}."],
  ["admin", "quick_sale", "Quick Sale", ["sms", "email"], "Quick sale completed for {{Name}}. Invoice {{Invoice No}}, amount {{Price}}."],
  ["admin", "daily_sale", "Daily Sale", ["sms", "email"], "Daily sale summary for {{Date}}: {{Price}} collected at {{Salon Name}}."],
  ["admin", "daily_appointment", "Daily Appointment", ["sms", "email"], "Daily appointments for {{Date}} are ready for review."],
  ["admin", "bill_delete", "Bill Delete", ["sms", "email"], "Bill deleted/voided: {{Invoice No}} for {{Name}}. Review audit trail."],
  ["staff", "daily_sale", "Daily Sale", ["sms", "email"], "Hi {{Staff}}, your daily sale summary for {{Date}} is {{Price}}."],
  ["staff", "new_appointment", "New Appointment", ["sms", "whatsapp"], "Hi {{Staff}}, new {{Service}} appointment for {{Name}} on {{Date}} at {{Time}}."],
  ["staff", "staff_booking", "Staff Booking", ["sms", "whatsapp"], "Hi {{Staff}}, booking assigned: {{Name}}, {{Service}}, {{Date}} {{Time}}."]
];

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeChannel(value) {
  const channel = text(value || "sms").toLowerCase();
  if (!CHANNELS.has(channel)) throw badRequest("Unsupported message channel");
  return channel;
}

function normalizeAudience(value) {
  const audience = text(value || "client").toLowerCase();
  if (!AUDIENCES.has(audience)) throw badRequest("Unsupported audience");
  return audience;
}

function normalizeEventKey(value) {
  return text(value || "custom").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "custom";
}

function templateKeyFor(channel, audience, eventKey) {
  return `${channel}_${audience}_${eventKey}`;
}

function categoryFor(audience, eventKey) {
  return `${audience}:${eventKey}`;
}

function splitCategory(category = "") {
  const [audience, ...eventParts] = String(category || "").split(":");
  if (AUDIENCES.has(audience)) return { audience, eventKey: normalizeEventKey(eventParts.join(":") || "custom") };
  return { audience: "client", eventKey: normalizeEventKey(category || "custom") };
}

function safeJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function variablesFromBody(body = "") {
  const found = new Set();
  String(body).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, name) => {
    found.add(String(name || "").trim());
    return "";
  });
  return [...found];
}

function renderBody(body = "", values = {}) {
  const source = { ...SAMPLE_VALUES, ...values };
  return String(body || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, name) => {
    const key = String(name || "").trim();
    return source[key] ?? source[key.replace(/\s+/g, "_")] ?? `[${key}]`;
  });
}

function accessBranch(access = {}, query = {}) {
  return text(query.branchId || query.branch_id || access.branchId || "");
}

function actorId(access = {}) {
  return text(access.userId || access.actorUserId || access.username || access.role || "system");
}

function catalog() {
  return EVENT_CATALOG.flatMap(([audience, eventKey, title, channels, body]) => {
    return channels.map((channel) => ({
      audience,
      eventKey,
      title,
      channel,
      templateKey: templateKeyFor(channel, audience, eventKey),
      name: `${title} ${channel.toUpperCase()}`,
      category: categoryFor(audience, eventKey),
      body,
      variables: variablesFromBody(body),
      providerTemplateId: channel === "whatsapp" ? eventKey : "",
      status: "active"
    }));
  });
}

function templateRow(row, preferenceMap = new Map()) {
  const category = splitCategory(row.category);
  const variables = safeJson(row.variables_json, []);
  const preference = preferenceMap.get(`${category.audience}:${category.eventKey}:${row.channel}`) || {};
  return {
    id: row.id,
    templateKey: row.template_key,
    name: row.name,
    title: row.name,
    channel: row.channel,
    audience: category.audience,
    eventKey: category.eventKey,
    category: row.category,
    purpose: row.purpose || "",
    body: row.body || "",
    variables: Array.isArray(variables) ? variables : [],
    providerTemplateName: row.provider_template_id || "",
    providerTemplateId: row.provider_template_id || "",
    status: row.status || "draft",
    enabled: preference.enabled !== undefined ? Boolean(preference.enabled) : row.status !== "paused" && row.status !== "archived",
    approvalStatus: row.approval_status || "",
    providerStatus: row.provider_status || "",
    charCount: String(row.body || "").length,
    updatedAt: row.updated_at || ""
  };
}

function hasTable(table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @table").get({ table });
}

function ensureDefaults(access = {}) {
  ensureMessageTemplateStudioSchema();
  const tenantId = text(access.tenantId || "tenant_aura");
  const createdBy = actorId(access);
  const stamp = now();
  const insertTemplate = db.prepare(`
    INSERT OR IGNORE INTO engagement_templates
    (id, tenant_id, branch_id, template_key, name, channel, category, language, purpose, body, variables_json,
     provider_template_id, provider_status, approval_status, status, quiet_hours_json, consent_required, opt_out_required,
     created_by, updated_by, created_at, updated_at)
    VALUES
    (@id, @tenantId, @branchId, @templateKey, @name, @channel, @category, 'en', @purpose, @body, @variablesJson,
     @providerTemplateId, @providerStatus, @approvalStatus, @status, '{}', 1, 1, @createdBy, @createdBy, @stamp, @stamp)
  `);
  const insertPreference = db.prepare(`
    INSERT OR IGNORE INTO notification_preferences
    (id, tenantId, branchId, audience, eventKey, channel, templateKey, enabled, createdAt, updatedAt)
    VALUES (@id, @tenantId, @branchId, @audience, @eventKey, @channel, @templateKey, 1, @stamp, @stamp)
  `);
  db.transaction(() => {
    for (const item of catalog()) {
      insertTemplate.run({
        id: id("msg_tpl"),
        tenantId,
        branchId: "",
        templateKey: item.templateKey,
        name: item.name,
        channel: item.channel,
        category: item.category,
        purpose: item.title,
        body: item.body,
        variablesJson: JSON.stringify(item.variables),
        providerTemplateId: item.providerTemplateId,
        providerStatus: item.channel === "whatsapp" ? "pending_provider" : "not_required",
        approvalStatus: item.channel === "whatsapp" ? "pending" : "approved",
        status: item.status,
        createdBy,
        stamp
      });
      insertPreference.run({
        id: id("notif_pref"),
        tenantId,
        branchId: accessBranch(access),
        audience: item.audience,
        eventKey: item.eventKey,
        channel: item.channel,
        templateKey: item.templateKey,
        stamp
      });
    }
  })();
}

function preferenceRows(access = {}, query = {}) {
  ensureDefaults(access);
  const rows = db.prepare(`
    SELECT * FROM notification_preferences
    WHERE tenantId = @tenantId AND branchId = @branchId
    ORDER BY audience ASC, eventKey ASC, channel ASC
  `).all({ tenantId: access.tenantId, branchId: accessBranch(access, query) });
  return rows;
}

function preferenceMap(access = {}, query = {}) {
  return new Map(preferenceRows(access, query).map((row) => [`${row.audience}:${row.eventKey}:${row.channel}`, row]));
}

function sentCounts(access = {}) {
  if (!hasTable("message_logs")) return new Map();
  const rows = db.prepare(`
    SELECT payload, channel
    FROM message_logs
    WHERE tenantId = @tenantId
  `).all({ tenantId: access.tenantId });
  const counts = new Map();
  for (const row of rows) {
    const payload = safeJson(row.payload, {});
    const key = `${payload.templateKey || payload.template || ""}:${row.channel || ""}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export const messageTemplateStudioService = {
  list(query = {}, access = {}) {
    ensureDefaults(access);
    const branchId = accessBranch(access, query);
    const channel = query.channel ? normalizeChannel(query.channel) : "";
    const audience = query.audience ? normalizeAudience(query.audience) : "";
    const search = text(query.q || query.search || "").toLowerCase();
    const clauses = ["tenant_id = @tenantId", "(branch_id = @branchId OR branch_id = '')", "archived_at = ''"];
    const params = { tenantId: access.tenantId, branchId, limit: Math.min(Math.max(Number(query.limit || 300), 1), 500) };
    if (channel) {
      clauses.push("channel = @channel");
      params.channel = channel;
    }
    if (audience) {
      clauses.push("category LIKE @audiencePrefix");
      params.audiencePrefix = `${audience}:%`;
    }
    if (search) {
      clauses.push("lower(template_key || ' ' || name || ' ' || purpose || ' ' || body) LIKE @search");
      params.search = `%${search}%`;
    }
    const prefs = preferenceMap(access, query);
    const rows = db.prepare(`
      SELECT * FROM engagement_templates
      WHERE ${clauses.join(" AND ")}
      ORDER BY channel ASC, category ASC, name ASC
      LIMIT @limit
    `).all(params).map((row) => templateRow(row, prefs));
    const byChannel = rows.reduce((acc, row) => {
      acc[row.channel] = (acc[row.channel] || 0) + 1;
      return acc;
    }, {});
    return {
      summary: {
        totalTemplates: rows.length,
        smsTemplates: byChannel.sms || 0,
        whatsappTemplates: byChannel.whatsapp || 0,
        emailTemplates: byChannel.email || 0,
        enabledTemplates: rows.filter((row) => row.enabled).length
      },
      templates: rows,
      tabs: ["notification_settings", "sms", "whatsapp", "email", "message_history"]
    };
  },

  create(payload = {}, access = {}) {
    ensureDefaults(access);
    const channel = normalizeChannel(payload.channel);
    const audience = normalizeAudience(payload.audience);
    const eventKey = normalizeEventKey(payload.eventKey || payload.category || "custom");
    const name = text(payload.name);
    const body = text(payload.body);
    if (!name) throw badRequest("Template name is required");
    if (!body) throw badRequest("Template body is required");
    const stamp = now();
    const templateKey = normalizeEventKey(payload.templateKey || templateKeyFor(channel, audience, eventKey));
    const row = {
      id: id("msg_tpl"),
      tenantId: access.tenantId,
      branchId: accessBranch(access, payload),
      templateKey,
      name,
      channel,
      category: categoryFor(audience, eventKey),
      purpose: text(payload.purpose || name),
      body,
      variablesJson: JSON.stringify(payload.variables?.length ? payload.variables : variablesFromBody(body)),
      providerTemplateId: text(payload.providerTemplateName || payload.providerTemplateId || ""),
      providerStatus: channel === "whatsapp" ? "pending_provider" : "not_required",
      approvalStatus: channel === "whatsapp" ? "pending" : "approved",
      status: payload.enabled === false ? "paused" : text(payload.status || "active"),
      actor: actorId(access),
      stamp
    };
    db.prepare(`
      INSERT INTO engagement_templates
      (id, tenant_id, branch_id, template_key, name, channel, category, language, purpose, body, variables_json,
       provider_template_id, provider_status, approval_status, status, quiet_hours_json, consent_required, opt_out_required,
       created_by, updated_by, created_at, updated_at)
      VALUES
      (@id, @tenantId, @branchId, @templateKey, @name, @channel, @category, 'en', @purpose, @body, @variablesJson,
       @providerTemplateId, @providerStatus, @approvalStatus, @status, '{}', 1, 1, @actor, @actor, @stamp, @stamp)
    `).run(row);
    this.updatePreferences({ preferences: [{ audience, eventKey, channel, templateKey, enabled: payload.enabled !== false }] }, access);
    return this.get(row.id, access);
  },

  get(idValue, access = {}) {
    ensureDefaults(access);
    const row = db.prepare("SELECT * FROM engagement_templates WHERE tenant_id = @tenantId AND id = @id").get({ tenantId: access.tenantId, id: idValue });
    if (!row) throw notFound("Message template not found");
    return templateRow(row, preferenceMap(access));
  },

  update(idValue, payload = {}, access = {}) {
    ensureDefaults(access);
    const existing = this.get(idValue, access);
    const channel = payload.channel ? normalizeChannel(payload.channel) : existing.channel;
    const audience = payload.audience ? normalizeAudience(payload.audience) : existing.audience;
    const eventKey = normalizeEventKey(payload.eventKey || existing.eventKey);
    const body = payload.body === undefined ? existing.body : text(payload.body);
    if (!body) throw badRequest("Template body is required");
    const next = {
      id: idValue,
      tenantId: access.tenantId,
      branchId: accessBranch(access, payload),
      templateKey: normalizeEventKey(payload.templateKey || existing.templateKey),
      name: text(payload.name || existing.name),
      channel,
      category: categoryFor(audience, eventKey),
      purpose: text(payload.purpose || existing.purpose || existing.name),
      body,
      variablesJson: JSON.stringify(payload.variables?.length ? payload.variables : variablesFromBody(body)),
      providerTemplateId: text(payload.providerTemplateName || payload.providerTemplateId || existing.providerTemplateId || ""),
      status: payload.enabled === false ? "paused" : text(payload.status || existing.status || "active"),
      actor: actorId(access),
      stamp: now()
    };
    db.prepare(`
      UPDATE engagement_templates
      SET branch_id = @branchId, template_key = @templateKey, name = @name, channel = @channel,
          category = @category, purpose = @purpose, body = @body, variables_json = @variablesJson,
          provider_template_id = @providerTemplateId, status = @status, updated_by = @actor,
          updated_at = @stamp, version = version + 1
      WHERE tenant_id = @tenantId AND id = @id
    `).run(next);
    if (payload.enabled !== undefined || payload.templateKey || payload.eventKey || payload.channel || payload.audience) {
      this.updatePreferences({ preferences: [{ audience, eventKey, channel, templateKey: next.templateKey, enabled: payload.enabled !== false }] }, access);
    }
    return this.get(idValue, access);
  },

  preview(payload = {}) {
    const body = text(payload.body || payload.message || "");
    return {
      body,
      rendered: renderBody(body, payload.sample || payload.variables || {}),
      sample: { ...SAMPLE_VALUES, ...(payload.sample || {}) },
      variables: variablesFromBody(body)
    };
  },

  testSend(idValue, payload = {}, access = {}) {
    const template = this.get(idValue, access);
    const rendered = renderBody(template.body, payload.sample || payload.variables || {});
    const stamp = now();
    const recipient = text(payload.contact || payload.recipient || "test-recipient");
    const log = {
      id: id("msg_log"),
      tenantId: access.tenantId,
      branchId: accessBranch(access, payload),
      campaignId: "",
      clientId: text(payload.clientId || ""),
      channel: template.channel,
      recipient,
      message: rendered,
      direction: "outbound",
      status: "queued",
      providerMessageId: "",
      payload: JSON.stringify({
        templateId: template.id,
        templateKey: template.templateKey,
        messageType: "template_test_send",
        providerUnavailable: true,
        createdBy: actorId(access)
      }),
      providerResponse: JSON.stringify({ status: "provider_unavailable", reason: "Test send logged without provider dispatch" }),
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO message_logs
      (id, tenantId, branchId, campaignId, clientId, channel, recipient, message, direction, status,
       providerMessageId, payload, providerResponse, createdAt, updatedAt)
      VALUES
      (@id, @tenantId, @branchId, @campaignId, @clientId, @channel, @recipient, @message, @direction, @status,
       @providerMessageId, @payload, @providerResponse, @createdAt, @updatedAt)
    `).run(log);
    return {
      templateId: template.id,
      templateKey: template.templateKey,
      messageLogId: log.id,
      channel: template.channel,
      status: "queued",
      providerStatus: "provider_unavailable",
      recipient,
      rendered
    };
  },

  preferences(query = {}, access = {}) {
    const rows = preferenceRows(access, query);
    const counts = sentCounts(access);
    const templateRows = this.list({ limit: 500 }, access).templates;
    const templateByKey = new Map(templateRows.map((row) => [row.templateKey, row]));
    const mapped = rows.map((row) => {
      const template = templateByKey.get(row.templateKey) || {};
      return {
        id: row.id,
        audience: row.audience,
        eventKey: row.eventKey,
        eventName: template.purpose || template.name || row.eventKey.replace(/_/g, " "),
        channel: row.channel,
        templateKey: row.templateKey,
        templateId: template.id || "",
        enabled: Boolean(row.enabled),
        lastSentCount: counts.get(`${row.templateKey}:${row.channel}`) || 0,
        updatedAt: row.updatedAt
      };
    });
    const sections = [
      { key: "client", title: "Client Notifications", rows: mapped.filter((row) => row.audience === "client") },
      { key: "admin", title: "Admin Notifications", rows: mapped.filter((row) => row.audience === "admin") },
      { key: "staff", title: "Staff Notifications", rows: mapped.filter((row) => row.audience === "staff") }
    ];
    return { sections, preferences: mapped };
  },

  updatePreferences(payload = {}, access = {}) {
    ensureDefaults(access);
    const rows = Array.isArray(payload.preferences) ? payload.preferences : [payload];
    const stamp = now();
    const branchId = accessBranch(access, payload);
    const upsert = db.prepare(`
      INSERT INTO notification_preferences
      (id, tenantId, branchId, audience, eventKey, channel, templateKey, enabled, createdAt, updatedAt)
      VALUES (@id, @tenantId, @branchId, @audience, @eventKey, @channel, @templateKey, @enabled, @stamp, @stamp)
      ON CONFLICT(tenantId, branchId, audience, eventKey, channel)
      DO UPDATE SET templateKey = excluded.templateKey, enabled = excluded.enabled, updatedAt = excluded.updatedAt
    `);
    db.transaction(() => {
      for (const item of rows) {
        upsert.run({
          id: text(item.id || "") || id("notif_pref"),
          tenantId: access.tenantId,
          branchId,
          audience: normalizeAudience(item.audience),
          eventKey: normalizeEventKey(item.eventKey),
          channel: normalizeChannel(item.channel),
          templateKey: text(item.templateKey || ""),
          enabled: item.enabled === false || item.enabled === 0 ? 0 : 1,
          stamp
        });
      }
    })();
    return this.preferences({ branchId }, access);
  }
};
