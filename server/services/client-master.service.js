import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/app-error.js";
import { securityService } from "./security.service.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;

const managerRoles = new Set(["owner", "admin", "superAdmin", "manager"]);
const sourceTypes = new Set(["walk_in", "referral", "whatsapp", "instagram", "facebook", "google", "website", "campaign", "marketplace", "corporate", "other"]);
const preferenceTypes = new Set(["general", "allergy", "skin", "hair", "chemical", "communication", "privacy", "medical", "service"]);
const riskLevels = new Set(["none", "low", "medium", "high"]);
const consultationTypes = new Set(["general", "hair", "skin", "bridal", "chemical", "spa", "wellness", "medical"]);
const feedbackTypes = new Set(["service", "visit", "staff", "product", "membership", "package", "branch"]);
const triggerEvents = new Set(["visit_completed", "invoice_paid", "appointment_completed", "service_completed", "membership_sold", "package_sold"]);

function normalizeAccess(access = {}) {
  if (!access.tenantId) throw forbidden("Tenant context is required");
  return access;
}

function requireManager(access) {
  if (!managerRoles.has(access.role)) throw forbidden("Only manager/admin/owner can manage Client Masters");
}

function assertBranch(access, branchId) {
  if (branchId) tenantService.assertBranchAccess(access, branchId);
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntValue(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolInt(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "yes" ? 1 : 0;
}

function json(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function parseJson(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseJsonArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonObject(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function deriveCode(value = "", fallbackPrefix = "CM") {
  const compact = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return (compact || `${fallbackPrefix}${Date.now().toString().slice(-5)}`).slice(0, 18);
}

function cleanEnum(value, allowed, fallback, label) {
  const normalized = String(value || fallback).trim().replace(/[\s-]+/g, "_").toLowerCase();
  if (!allowed.has(normalized)) throw badRequest(`Invalid ${label}`);
  return normalized;
}

function normalizeStatus(value = "active") {
  const normalized = String(value || "active").trim().toLowerCase();
  if (!["active", "draft", "archived"].includes(normalized)) throw badRequest("Invalid status");
  return normalized;
}

function branchScopedWhere(access, query, params) {
  const filters = ["tenant_id = @tenant_id"];
  const branchId = query.branchId || query.branch_id || access.requestedBranchId || "";
  if (branchId) {
    params.branch_id = branchId;
    filters.push("(branch_id = @branch_id OR branch_id = '')");
  }
  if (["staff", "frontDesk"].includes(access.role) && access.branchId) {
    params.access_branch_id = access.branchId;
    filters.push("(branch_id = @access_branch_id OR branch_id = '')");
  }
  return filters;
}

function addCommonFilters(filters, params, query, searchColumns) {
  if (query.status) {
    params.status = normalizeStatus(query.status);
    filters.push("status = @status");
  }
  if (query.visibleOnly === "true" || query.visibleOnly === true) filters.push("hide = 0 AND status = 'active'");
  if (query.includeArchived !== "true" && query.includeArchived !== true && !query.status) filters.push("status != 'archived'");
  if (query.q) {
    params.q = `%${String(query.q).trim().toLowerCase()}%`;
    filters.push(`(${searchColumns.map((column) => `lower(${column}) LIKE @q`).join(" OR ")})`);
  }
}

function buildCommon(payload, access, existing, prefix) {
  const stamp = now();
  const name = String(payload.name ?? existing?.name ?? "").trim();
  if (!name) throw badRequest("name is required");
  const branchId = payload.branchId ?? payload.branch_id ?? existing?.branch_id ?? "";
  assertBranch(access, branchId);
  return {
    id: existing?.id || payload.id || makeId(prefix),
    tenant_id: access.tenantId,
    branch_id: branchId,
    code: deriveCode(payload.code ?? payload.shortCode ?? existing?.code ?? name, prefix.toUpperCase()),
    name,
    hide: boolInt(payload.hide ?? existing?.hide ?? 0),
    status: normalizeStatus(payload.status ?? existing?.status ?? "active"),
    version: existing ? Number(existing.version || 1) + 1 : 1,
    created_by: existing?.created_by || access.userId || "",
    created_at: existing?.created_at || stamp,
    updated_at: stamp
  };
}

function categoryRow(payload, access, existing = null) {
  const common = buildCommon(payload, access, existing, "ccat");
  return {
    ...common,
    description: String(payload.description ?? existing?.description ?? ""),
    color: String(payload.color ?? existing?.color ?? "#4B1238"),
    discount_percent: parseNumber(payload.discountPercent ?? payload.discount_percent ?? existing?.discount_percent, 0),
    loyalty_multiplier: parseNumber(payload.loyaltyMultiplier ?? payload.loyalty_multiplier ?? existing?.loyalty_multiplier, 1),
    visit_threshold: parseIntValue(payload.visitThreshold ?? payload.visit_threshold ?? existing?.visit_threshold, 0),
    spend_threshold: parseNumber(payload.spendThreshold ?? payload.spend_threshold ?? existing?.spend_threshold, 0)
  };
}

function sourceRow(payload, access, existing = null) {
  const common = buildCommon(payload, access, existing, "csrc");
  return {
    ...common,
    source_type: cleanEnum(payload.sourceType ?? payload.source_type ?? existing?.source_type, sourceTypes, "walk_in", "source type"),
    default_campaign_id: String(payload.defaultCampaignId ?? payload.default_campaign_id ?? existing?.default_campaign_id ?? ""),
    referral_required: boolInt(payload.referralRequired ?? payload.referral_required ?? existing?.referral_required ?? 0),
    attribution_window_days: parseIntValue(payload.attributionWindowDays ?? payload.attribution_window_days ?? existing?.attribution_window_days, 30),
    notes: String(payload.notes ?? existing?.notes ?? "")
  };
}

function preferenceRow(payload, access, existing = null) {
  const common = buildCommon(payload, access, existing, "cpref");
  return {
    ...common,
    preference_type: cleanEnum(payload.preferenceType ?? payload.preference_type ?? existing?.preference_type, preferenceTypes, "general", "preference type"),
    options_json: json(payload.options ?? parseJsonArray(existing?.options_json), []),
    risk_level: cleanEnum(payload.riskLevel ?? payload.risk_level ?? existing?.risk_level, riskLevels, "none", "risk level"),
    consent_required: boolInt(payload.consentRequired ?? payload.consent_required ?? existing?.consent_required ?? 0),
    notes: String(payload.notes ?? existing?.notes ?? "")
  };
}

function consultationRow(payload, access, existing = null) {
  const common = buildCommon(payload, access, existing, "cform");
  return {
    ...common,
    template_type: cleanEnum(payload.templateType ?? payload.template_type ?? existing?.template_type, consultationTypes, "general", "template type"),
    sections_json: json(payload.sections ?? parseJsonArray(existing?.sections_json), []),
    consent_required: boolInt(payload.consentRequired ?? payload.consent_required ?? existing?.consent_required ?? 1),
    validity_days: parseIntValue(payload.validityDays ?? payload.validity_days ?? existing?.validity_days, 180),
    notes: String(payload.notes ?? existing?.notes ?? "")
  };
}

function feedbackRow(payload, access, existing = null) {
  const common = buildCommon(payload, access, existing, "cfdbk");
  return {
    ...common,
    feedback_type: cleanEnum(payload.feedbackType ?? payload.feedback_type ?? existing?.feedback_type, feedbackTypes, "service", "feedback type"),
    trigger_event: cleanEnum(payload.triggerEvent ?? payload.trigger_event ?? existing?.trigger_event, triggerEvents, "visit_completed", "trigger event"),
    rating_scale: Math.max(1, Math.min(parseIntValue(payload.ratingScale ?? payload.rating_scale ?? existing?.rating_scale, 5), 10)),
    questions_json: json(payload.questions ?? parseJsonArray(existing?.questions_json), []),
    score_rules_json: json(payload.scoreRules ?? parseJsonObject(existing?.score_rules_json), {}),
    notes: String(payload.notes ?? existing?.notes ?? "")
  };
}

function rowToCategory(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    description: row.description,
    color: row.color,
    discountPercent: Number(row.discount_percent || 0),
    loyaltyMultiplier: Number(row.loyalty_multiplier || 1),
    visitThreshold: Number(row.visit_threshold || 0),
    spendThreshold: Number(row.spend_threshold || 0),
    hide: Number(row.hide || 0) === 1,
    status: row.status,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToSource(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    sourceType: row.source_type,
    defaultCampaignId: row.default_campaign_id,
    referralRequired: Number(row.referral_required || 0) === 1,
    attributionWindowDays: Number(row.attribution_window_days || 0),
    hide: Number(row.hide || 0) === 1,
    notes: row.notes,
    status: row.status,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToPreference(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    preferenceType: row.preference_type,
    options: parseJsonArray(row.options_json),
    riskLevel: row.risk_level,
    consentRequired: Number(row.consent_required || 0) === 1,
    hide: Number(row.hide || 0) === 1,
    notes: row.notes,
    status: row.status,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToConsultation(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    templateType: row.template_type,
    sections: parseJsonArray(row.sections_json),
    consentRequired: Number(row.consent_required || 0) === 1,
    validityDays: Number(row.validity_days || 0),
    hide: Number(row.hide || 0) === 1,
    notes: row.notes,
    status: row.status,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToFeedback(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    feedbackType: row.feedback_type,
    triggerEvent: row.trigger_event,
    ratingScale: Number(row.rating_scale || 5),
    questions: parseJsonArray(row.questions_json),
    scoreRules: parseJsonObject(row.score_rules_json),
    hide: Number(row.hide || 0) === 1,
    notes: row.notes,
    status: row.status,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const definitions = {
  categories: {
    table: "client_category_master",
    label: "Client category",
    build: categoryRow,
    map: rowToCategory,
    search: ["code", "name", "description"],
    insert: `INSERT INTO client_category_master (
      id, tenant_id, branch_id, code, name, description, color, discount_percent,
      loyalty_multiplier, visit_threshold, spend_threshold, hide, status, version,
      created_by, created_at, updated_at
    ) VALUES (
      @id, @tenant_id, @branch_id, @code, @name, @description, @color, @discount_percent,
      @loyalty_multiplier, @visit_threshold, @spend_threshold, @hide, @status, @version,
      @created_by, @created_at, @updated_at
    )`,
    update: `UPDATE client_category_master SET
      branch_id = @branch_id, code = @code, name = @name, description = @description,
      color = @color, discount_percent = @discount_percent, loyalty_multiplier = @loyalty_multiplier,
      visit_threshold = @visit_threshold, spend_threshold = @spend_threshold, hide = @hide,
      status = @status, version = @version, updated_at = @updated_at
      WHERE id = @id AND tenant_id = @tenant_id`
  },
  sources: {
    table: "client_source_master",
    label: "Client source",
    build: sourceRow,
    map: rowToSource,
    search: ["code", "name", "source_type", "notes"],
    insert: `INSERT INTO client_source_master (
      id, tenant_id, branch_id, code, name, source_type, default_campaign_id,
      referral_required, attribution_window_days, hide, notes, status, version,
      created_by, created_at, updated_at
    ) VALUES (
      @id, @tenant_id, @branch_id, @code, @name, @source_type, @default_campaign_id,
      @referral_required, @attribution_window_days, @hide, @notes, @status, @version,
      @created_by, @created_at, @updated_at
    )`,
    update: `UPDATE client_source_master SET
      branch_id = @branch_id, code = @code, name = @name, source_type = @source_type,
      default_campaign_id = @default_campaign_id, referral_required = @referral_required,
      attribution_window_days = @attribution_window_days, hide = @hide, notes = @notes,
      status = @status, version = @version, updated_at = @updated_at
      WHERE id = @id AND tenant_id = @tenant_id`
  },
  preferences: {
    table: "client_preference_master",
    label: "Client preference",
    build: preferenceRow,
    map: rowToPreference,
    search: ["code", "name", "preference_type", "notes"],
    insert: `INSERT INTO client_preference_master (
      id, tenant_id, branch_id, code, name, preference_type, options_json, risk_level,
      consent_required, hide, notes, status, version, created_by, created_at, updated_at
    ) VALUES (
      @id, @tenant_id, @branch_id, @code, @name, @preference_type, @options_json, @risk_level,
      @consent_required, @hide, @notes, @status, @version, @created_by, @created_at, @updated_at
    )`,
    update: `UPDATE client_preference_master SET
      branch_id = @branch_id, code = @code, name = @name, preference_type = @preference_type,
      options_json = @options_json, risk_level = @risk_level, consent_required = @consent_required,
      hide = @hide, notes = @notes, status = @status, version = @version, updated_at = @updated_at
      WHERE id = @id AND tenant_id = @tenant_id`
  },
  "consultation-templates": {
    table: "client_consultation_template_master",
    label: "Consultation template",
    build: consultationRow,
    map: rowToConsultation,
    search: ["code", "name", "template_type", "notes"],
    insert: `INSERT INTO client_consultation_template_master (
      id, tenant_id, branch_id, code, name, template_type, sections_json, consent_required,
      validity_days, hide, notes, status, version, created_by, created_at, updated_at
    ) VALUES (
      @id, @tenant_id, @branch_id, @code, @name, @template_type, @sections_json, @consent_required,
      @validity_days, @hide, @notes, @status, @version, @created_by, @created_at, @updated_at
    )`,
    update: `UPDATE client_consultation_template_master SET
      branch_id = @branch_id, code = @code, name = @name, template_type = @template_type,
      sections_json = @sections_json, consent_required = @consent_required,
      validity_days = @validity_days, hide = @hide, notes = @notes, status = @status,
      version = @version, updated_at = @updated_at
      WHERE id = @id AND tenant_id = @tenant_id`
  },
  "feedback-definitions": {
    table: "client_feedback_definition_master",
    label: "Feedback definition",
    build: feedbackRow,
    map: rowToFeedback,
    search: ["code", "name", "feedback_type", "trigger_event", "notes"],
    insert: `INSERT INTO client_feedback_definition_master (
      id, tenant_id, branch_id, code, name, feedback_type, trigger_event, rating_scale,
      questions_json, score_rules_json, hide, notes, status, version, created_by,
      created_at, updated_at
    ) VALUES (
      @id, @tenant_id, @branch_id, @code, @name, @feedback_type, @trigger_event, @rating_scale,
      @questions_json, @score_rules_json, @hide, @notes, @status, @version, @created_by,
      @created_at, @updated_at
    )`,
    update: `UPDATE client_feedback_definition_master SET
      branch_id = @branch_id, code = @code, name = @name, feedback_type = @feedback_type,
      trigger_event = @trigger_event, rating_scale = @rating_scale, questions_json = @questions_json,
      score_rules_json = @score_rules_json, hide = @hide, notes = @notes, status = @status,
      version = @version, updated_at = @updated_at
      WHERE id = @id AND tenant_id = @tenant_id`
  }
};

function definitionFor(kind) {
  const definition = definitions[kind];
  if (!definition) throw notFound("Client master definition not found");
  return definition;
}

export class ClientMasterService {
  summary(query = {}, access) {
    access = normalizeAccess(access);
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || "";
    if (branchId) assertBranch(access, branchId);
    const params = { tenant_id: access.tenantId, branch_id: branchId };
    const countFor = (table) => {
      const filters = ["tenant_id = @tenant_id", "status != 'archived'"];
      if (branchId) filters.push("(branch_id = @branch_id OR branch_id = '')");
      return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${filters.join(" AND ")}`).get(params)?.count || 0);
    };
    const clientsFilters = ["tenantId = @tenant_id", "(deletedAt IS NULL OR deletedAt = '')"];
    const clientParams = { tenant_id: access.tenantId };
    if (branchId) {
      clientsFilters.push("branchId = @branch_id");
      clientParams.branch_id = branchId;
    }
    const clientsWhere = clientsFilters.length ? `WHERE ${clientsFilters.join(" AND ")}` : "";
    return {
      clientProfiles: Number(db.prepare(`SELECT COUNT(*) AS count FROM clients ${clientsWhere}`).get(clientParams)?.count || 0),
      categories: countFor(definitions.categories.table),
      sources: countFor(definitions.sources.table),
      preferences: countFor(definitions.preferences.table),
      consultationTemplates: countFor(definitions["consultation-templates"].table),
      feedbackDefinitions: countFor(definitions["feedback-definitions"].table)
    };
  }

  list(kind, query = {}, access) {
    access = normalizeAccess(access);
    const definition = definitionFor(kind);
    const params = {
      tenant_id: access.tenantId,
      limit: Math.min(parseIntValue(query.limit, 250), 1000)
    };
    const filters = branchScopedWhere(access, query, params);
    addCommonFilters(filters, params, query, definition.search);
    if (kind === "sources" && query.sourceType) {
      params.source_type = cleanEnum(query.sourceType, sourceTypes, "walk_in", "source type");
      filters.push("source_type = @source_type");
    }
    if (kind === "preferences" && query.preferenceType) {
      params.preference_type = cleanEnum(query.preferenceType, preferenceTypes, "general", "preference type");
      filters.push("preference_type = @preference_type");
    }
    if (kind === "consultation-templates" && query.templateType) {
      params.template_type = cleanEnum(query.templateType, consultationTypes, "general", "template type");
      filters.push("template_type = @template_type");
    }
    if (kind === "feedback-definitions" && query.feedbackType) {
      params.feedback_type = cleanEnum(query.feedbackType, feedbackTypes, "service", "feedback type");
      filters.push("feedback_type = @feedback_type");
    }
    return db.prepare(`SELECT * FROM ${definition.table} WHERE ${filters.join(" AND ")}
      ORDER BY hide ASC, status ASC, name ASC LIMIT @limit`).all(params).map(definition.map);
  }

  get(kind, id, access) {
    access = normalizeAccess(access);
    const definition = definitionFor(kind);
    const row = db.prepare(`SELECT * FROM ${definition.table} WHERE id = ? AND tenant_id = ?`).get(id, access.tenantId);
    if (!row) throw notFound(`${definition.label} not found`);
    assertBranch(access, row.branch_id);
    return definition.map(row);
  }

  create(kind, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const definition = definitionFor(kind);
    const row = definition.build(payload, access);
    this.assertUnique(definition, row);
    db.transaction(() => {
      db.prepare(definition.insert).run(row);
      this.writeAudit(`client_master.${kind}.created`, definition.table, row.id, access, { after: row, branchId: row.branch_id });
    })();
    return this.get(kind, row.id, access);
  }

  update(kind, id, payload = {}, access) {
    access = normalizeAccess(access);
    requireManager(access);
    const definition = definitionFor(kind);
    const existing = db.prepare(`SELECT * FROM ${definition.table} WHERE id = ? AND tenant_id = ?`).get(id, access.tenantId);
    if (!existing) throw notFound(`${definition.label} not found`);
    assertBranch(access, existing.branch_id);
    if (payload.version === undefined) throw badRequest("version is required for optimistic locking");
    if (Number(payload.version) !== Number(existing.version || 1)) throw conflict(`${definition.label} has been updated by another request`);
    const next = definition.build(payload, access, existing);
    this.assertUnique(definition, next, id);
    db.transaction(() => {
      db.prepare(definition.update).run(next);
      this.writeAudit(`client_master.${kind}.updated`, definition.table, id, access, { before: existing, after: next, branchId: next.branch_id });
    })();
    return this.get(kind, id, access);
  }

  updateStatus(kind, id, payload = {}, access) {
    return this.update(kind, id, {
      status: payload.status,
      hide: payload.hide,
      version: payload.version
    }, access);
  }

  assertUnique(definition, row, ignoreId = "") {
    const existing = db.prepare(`SELECT id FROM ${definition.table}
      WHERE tenant_id = ? AND branch_id = ? AND code = ? AND id != ?`)
      .get(row.tenant_id, row.branch_id, row.code, ignoreId);
    if (existing) throw conflict(`${definition.label} code already exists for this branch`);
  }

  writeAudit(action, entityType, entityId, access, { before = null, after = null, branchId = "" } = {}) {
    const row = {
      id: makeId("cmaudit"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      actor_user_id: access.userId || "",
      actor_role: access.role || "",
      action,
      entity_type: entityType,
      entity_id: entityId,
      before_json: json(before, {}),
      after_json: json(after, {}),
      created_at: now()
    };
    db.prepare(`INSERT INTO client_master_audit_logs (
      id, tenant_id, branch_id, actor_user_id, actor_role, action, entity_type,
      entity_id, before_json, after_json, created_at
    ) VALUES (
      @id, @tenant_id, @branch_id, @actor_user_id, @actor_role, @action, @entity_type,
      @entity_id, @before_json, @after_json, @created_at
    )`).run(row);
    try {
      securityService.audit({ action, targetType: entityType, targetId: entityId, details: { branchId }, severity: "info" }, access);
    } catch {
      // Client master audit table remains the source of truth if global audit is unavailable.
    }
  }
}

export const clientMasterService = new ClientMasterService();
