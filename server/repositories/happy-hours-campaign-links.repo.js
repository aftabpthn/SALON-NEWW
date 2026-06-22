import { db } from "../db.js";
import { discountRulesRepo } from "./discount-rules.repo.js";
import { happyHoursControlTowerRepo } from "./happy-hours-control-tower.repo.js";

const CHANNELS = new Set(["whatsapp", "sms"]);
const STATUSES = new Set(["draft", "scheduled", "sent", "paused", "archived"]);

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursRuleCampaignLinks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    ruleId INTEGER NOT NULL,
    whatsappDraftId INTEGER DEFAULT NULL,
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    targetJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    scheduledFor TEXT DEFAULT NULL,
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hhRuleCampaignLinks_scope
    ON happyHoursRuleCampaignLinks(tenantId, branchId, status, createdAt);

  CREATE INDEX IF NOT EXISTS idx_hhRuleCampaignLinks_rule
    ON happyHoursRuleCampaignLinks(tenantId, branchId, ruleId);
`);

const statements = {
  insert: db.prepare(`
    INSERT INTO happyHoursRuleCampaignLinks (
      tenantId, branchId, ruleId, whatsappDraftId, channel, title, message,
      targetJson, status, scheduledFor, createdBy
    )
    VALUES (
      @tenantId, @branchId, @ruleId, @whatsappDraftId, @channel, @title, @message,
      @targetJson, @status, @scheduledFor, @createdBy
    )
  `),
  list: db.prepare(`
    SELECT l.*, r.name AS ruleName, r.status AS ruleStatus, r.validFrom, r.validTo
    FROM happyHoursRuleCampaignLinks l
    LEFT JOIN discountRules r
      ON r.tenantId = l.tenantId
     AND r.branchId = l.branchId
     AND r.id = l.ruleId
    WHERE l.tenantId = @tenantId
      AND l.branchId = @branchId
      AND (@status = '' OR l.status = @status)
    ORDER BY l.createdAt DESC, l.id DESC
    LIMIT @limit OFFSET @offset
  `),
  getById: db.prepare(`
    SELECT *
    FROM happyHoursRuleCampaignLinks
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
    LIMIT 1
  `),
  updateStatus: db.prepare(`
    UPDATE happyHoursRuleCampaignLinks
    SET status = @status,
        updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `)
};

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function idFrom(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
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
  const text = String(value || fallback || "").trim();
  return text.slice(0, max);
}

function jsonText(value, fallback = {}) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value);
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    target: parseJson(row.targetJson, {})
  };
}

function actionSummary(action = {}) {
  if (action.type === "percent") return `${Number(action.value || 0)}% off`;
  if (action.type === "flat") return `Rs ${Math.round(Number(action.value || 0)) / 100} off`;
  if (action.type === "bundle_price") return `bundle price Rs ${Math.round(Number(action.value || 0)) / 100}`;
  return "special offer";
}

function listValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function targetDetails(rule = {}, data = {}) {
  const conditions = parseJson(rule.conditionsJson || rule.conditions, []);
  const action = parseJson(rule.actionJson || rule.action, {});
  const serviceCategories = new Set();
  const serviceIds = new Set();
  for (const condition of conditions) {
    if (condition.field === "serviceCategory") {
      listValue(condition.value).forEach((value) => serviceCategories.add(value));
    }
  }
  if (action.applyTo === "category") {
    listValue(action.targetIds).forEach((value) => serviceCategories.add(value));
  }
  if (action.applyTo === "service") {
    listValue(action.targetIds).forEach((value) => serviceIds.add(value));
  }
  const expiryDate = data.expiryDate || rule.validTo || null;
  return {
    segment: shortText(data.segment, "eligible_clients", 80),
    audienceLabel: shortText(data.audienceLabel, "Eligible clients", 120),
    branchId: rule.branchId,
    serviceCategories: [...serviceCategories],
    serviceIds: [...serviceIds],
    expiryDate,
    ruleId: rule.id,
    ruleStatus: rule.status,
    validFrom: rule.validFrom || null,
    validTo: rule.validTo || null
  };
}

function serviceText(details) {
  if (details.serviceCategories?.length) return details.serviceCategories.join(", ");
  if (details.serviceIds?.length) return details.serviceIds.join(", ");
  return "selected salon services";
}

function defaultMessage(rule, details, action, data = {}) {
  if (data.message) return shortText(data.message, "", 1200);
  const expiry = details.expiryDate ? ` Valid till ${details.expiryDate}.` : "";
  return `Hi {{name}}, ${rule.name} is approved at branch ${details.branchId}. Get ${actionSummary(action)} on ${serviceText(details)}.${expiry} Book your slot now.`;
}

export function previewCampaignFromRule(data = {}) {
  const current = requireScope(data);
  const ruleId = idFrom(data.ruleId);
  if (!ruleId) throw new Error("valid rule id is required");
  const rule = discountRulesRepo.getById({ ...current, id: ruleId });
  if (!rule) throw new Error("discount rule not found");
  const action = parseJson(rule.actionJson || rule.action, {});
  const details = targetDetails(rule, data);
  const target = {
    ...details,
    channel: channel(data.channel),
    campaignSource: "campaign_to_rule_link",
    manualReviewRequired: true
  };
  const eligible = rule.status === "active";
  const title = shortText(data.title, `${rule.name} campaign`, 180);
  return {
    ...current,
    eligible,
    reason: eligible ? "Rule is active and ready for campaign draft." : "Only approved/active rules can create campaign drafts.",
    rule: {
      id: rule.id,
      name: rule.name,
      status: rule.status,
      validFrom: rule.validFrom,
      validTo: rule.validTo
    },
    title,
    message: defaultMessage(rule, details, action, data),
    channel: target.channel,
    target,
    guardrails: [
      "Creates draft campaign only; never sends automatically.",
      "Uses linked rule status, expiry, branch, service/category target and selected segment.",
      "Customer messaging still needs manual approval before send."
    ]
  };
}

export function createCampaignDraftFromRule(data = {}) {
  const preview = previewCampaignFromRule(data);
  if (!preview.eligible) throw new Error(preview.reason);
  const payload = {
    tenantId: preview.tenantId,
    branchId: preview.branchId,
    ruleId: preview.rule.id,
    whatsappDraftId: null,
    channel: preview.channel,
    title: preview.title,
    message: preview.message,
    targetJson: jsonText(preview.target),
    status: status(data.status, "draft"),
    scheduledFor: data.scheduledFor || null,
    createdBy: data.createdBy || null
  };

  if (payload.channel === "whatsapp") {
    const draft = happyHoursControlTowerRepo.saveWhatsappDraft({
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      ruleId: payload.ruleId,
      title: payload.title,
      message: payload.message,
      target: preview.target,
      status: "draft",
      scheduledFor: payload.scheduledFor,
      createdBy: payload.createdBy
    });
    payload.whatsappDraftId = draft.id;
  }

  const result = statements.insert.run(payload);
  return {
    preview,
    campaign: parseRow(statements.getById.get({ ...payload, id: Number(result.lastInsertRowid) }))
  };
}

export function listCampaignLinks(scope = {}) {
  const current = requireScope(scope);
  const params = {
    ...current,
    status: STATUSES.has(String(scope.status || "")) ? String(scope.status) : "",
    limit: Math.min(200, Math.max(1, Number.parseInt(scope.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(scope.offset, 10) || 0)
  };
  return {
    rows: statements.list.all(params).map(parseRow),
    limit: params.limit,
    offset: params.offset
  };
}

export function updateCampaignStatus(scope = {}) {
  const current = requireScope(scope);
  const id = idFrom(scope.id);
  if (!id) throw new Error("valid campaign link id is required");
  const nextStatus = status(scope.status);
  statements.updateStatus.run({ ...current, id, status: nextStatus });
  return parseRow(statements.getById.get({ ...current, id }));
}

export const happyHoursCampaignLinksRepo = {
  previewCampaignFromRule,
  createCampaignDraftFromRule,
  listCampaignLinks,
  updateCampaignStatus
};
