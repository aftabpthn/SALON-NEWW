import { randomUUID } from "node:crypto";
import { DEFAULT_TENANT_ID, columnsFor, db } from "../db.js";
import { badRequest, forbidden, notFound } from "../utils/app-error.js";

const MODULES = [
  { key: "customer", label: "Customer", entity: "clients" },
  { key: "package", label: "Package", entity: "packages" },
  { key: "membership", label: "Membership", entity: "memberships" },
  { key: "product", label: "Product", entity: "products" },
  { key: "service", label: "Service", entity: "services" },
  { key: "vendor", label: "Vendor", entity: "suppliers" },
  { key: "staff", label: "Staff", entity: "staff" }
];

const MODE_KEYS = ["viewOnly", "syncMasterData", "allowRedemption", "allowEdit", "ownerApprovalRequired"];
const RISKY_MODES = new Set(["syncMasterData", "allowRedemption", "allowEdit"]);
const OWNER_ROLES = new Set(["owner", "admin", "superAdmin"]);

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;
const text = (value = "") => String(value || "").trim();
const boolInt = (value) => value ? 1 : 0;
const toJson = (value) => JSON.stringify(value ?? {});

function readJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function tableExists(table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @table").get({ table }));
}

function hasColumn(table, column) {
  try {
    return columnsFor(table).includes(column);
  } catch {
    return false;
  }
}

function accessScope(access = {}) {
  if (!access.tenantId) {
    access.tenantId = DEFAULT_TENANT_ID;
  }
  return access;
}

function assertOwner(access = {}) {
  accessScope(access);
  if (!OWNER_ROLES.has(access.role)) throw forbidden("Location sharing controls are restricted to owner/admin accounts");
}

function assertBranch(access = {}, branchId = "") {
  accessScope(access);
  if (!branchId || OWNER_ROLES.has(access.role) || access.role === "manager" || access.role === "analyst") return;
  if (!(access.branchIds || []).includes(branchId)) throw forbidden("This user does not have access to the requested branch");
}

function moduleDefinition(module) {
  const key = text(module).toLowerCase();
  const found = MODULES.find((item) => item.key === key);
  if (!found) throw badRequest(`Unsupported sharing module: ${module}`);
  return found;
}

function normalizeModes(input = {}, { forceOwnerApproval = true } = {}) {
  const source = readJson(input, {});
  const modes = Object.fromEntries(MODE_KEYS.map((key) => [key, Boolean(source[key])]));
  if (forceOwnerApproval && [...RISKY_MODES].some((key) => modes[key])) modes.ownerApprovalRequired = true;
  return modes;
}

function isRisky(modes = {}) {
  return [...RISKY_MODES].some((key) => Boolean(modes[key])) || Boolean(modes.ownerApprovalRequired);
}

function mapSetting(row = {}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId || "",
    module: row.module,
    label: MODULES.find((item) => item.key === row.module)?.label || row.module,
    enabled: Boolean(row.enabled),
    modes: normalizeModes(row.modes, { forceOwnerApproval: false }),
    overridePolicy: readJson(row.overridePolicy, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapRule(row = {}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId || "",
    sourceBranchId: row.sourceBranchId,
    targetBranchId: row.targetBranchId,
    module: row.module,
    label: MODULES.find((item) => item.key === row.module)?.label || row.module,
    modes: normalizeModes(row.modes, { forceOwnerApproval: false }),
    overridePolicy: readJson(row.overridePolicy, {}),
    approvalStatus: row.approvalStatus || "not_required",
    status: row.status || "active",
    createdBy: row.createdBy || "",
    approvedBy: row.approvedBy || "",
    approvedAt: row.approvedAt || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapEvent(row = {}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId || "",
    actorUserId: row.actorUserId || "",
    action: row.action,
    module: row.module || "",
    sourceBranchId: row.sourceBranchId || "",
    targetBranchId: row.targetBranchId || "",
    entityType: row.entityType || "",
    entityId: row.entityId || "",
    beforePayload: readJson(row.beforePayload, {}),
    afterPayload: readJson(row.afterPayload, {}),
    status: row.status || "recorded",
    createdAt: row.createdAt
  };
}

function mapConflict(row = {}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId || "",
    conflictKey: row.conflictKey,
    conflictType: row.conflictType,
    module: row.module,
    sourceBranchId: row.sourceBranchId || "",
    targetBranchId: row.targetBranchId || "",
    summary: row.summary,
    evidence: readJson(row.evidence, {}),
    resolution: readJson(row.resolution, {}),
    approvalStatus: row.approvalStatus || "not_required",
    status: row.status || "open",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapApproval(row = {}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId || "",
    requestType: row.requestType,
    module: row.module || "",
    sourceBranchId: row.sourceBranchId || "",
    targetBranchId: row.targetBranchId || "",
    relatedType: row.relatedType || "",
    relatedId: row.relatedId || "",
    requestedBy: row.requestedBy || "",
    decidedBy: row.decidedBy || "",
    decisionNote: row.decisionNote || "",
    payload: readJson(row.payload, {}),
    status: row.status || "pending",
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt || ""
  };
}

function insertEvent(access, payload = {}) {
  const row = {
    id: id("lshare_evt"),
    tenantId: access.tenantId,
    branchId: payload.branchId || payload.sourceBranchId || access.branchId || "",
    actorUserId: access.userId || "",
    action: payload.action || "location_sharing.updated",
    module: payload.module || "",
    sourceBranchId: payload.sourceBranchId || "",
    targetBranchId: payload.targetBranchId || "",
    entityType: payload.entityType || "",
    entityId: payload.entityId || "",
    beforePayload: toJson(payload.beforePayload || {}),
    afterPayload: toJson(payload.afterPayload || {}),
    status: payload.status || "recorded",
    createdAt: now()
  };
  db.prepare(`
    INSERT INTO locationSharingEvents
      (id, tenantId, branchId, actorUserId, action, module, sourceBranchId, targetBranchId, entityType, entityId, beforePayload, afterPayload, status, createdAt)
    VALUES
      (@id, @tenantId, @branchId, @actorUserId, @action, @module, @sourceBranchId, @targetBranchId, @entityType, @entityId, @beforePayload, @afterPayload, @status, @createdAt)
  `).run(row);
  return mapEvent(row);
}

function createApproval(access, payload = {}) {
  const row = {
    id: id("lshare_appr"),
    tenantId: access.tenantId,
    branchId: payload.branchId || payload.sourceBranchId || "",
    requestType: payload.requestType,
    module: payload.module || "",
    sourceBranchId: payload.sourceBranchId || "",
    targetBranchId: payload.targetBranchId || "",
    relatedType: payload.relatedType || "",
    relatedId: payload.relatedId || "",
    requestedBy: access.userId || "",
    decidedBy: "",
    decisionNote: "",
    payload: toJson(payload.payload || {}),
    status: "pending",
    requestedAt: now(),
    decidedAt: ""
  };
  db.prepare(`
    INSERT INTO locationSharingApprovals
      (id, tenantId, branchId, requestType, module, sourceBranchId, targetBranchId, relatedType, relatedId, requestedBy, decidedBy, decisionNote, payload, status, requestedAt, decidedAt)
    VALUES
      (@id, @tenantId, @branchId, @requestType, @module, @sourceBranchId, @targetBranchId, @relatedType, @relatedId, @requestedBy, @decidedBy, @decisionNote, @payload, @status, @requestedAt, @decidedAt)
  `).run(row);
  insertEvent(access, {
    action: "location_sharing.approval_requested",
    module: row.module,
    sourceBranchId: row.sourceBranchId,
    targetBranchId: row.targetBranchId,
    entityType: row.relatedType,
    entityId: row.relatedId,
    afterPayload: row
  });
  return mapApproval(row);
}

function ensureDefaultSettings(access) {
  const stamp = now();
  for (const item of MODULES) {
    db.prepare(`
      INSERT OR IGNORE INTO locationSharingSettings
        (id, tenantId, branchId, module, enabled, modes, overridePolicy, createdAt, updatedAt)
      VALUES
        (@id, @tenantId, '', @module, 0, @modes, @overridePolicy, @createdAt, @updatedAt)
    `).run({
      id: id("lshare_set"),
      tenantId: access.tenantId,
      module: item.key,
      modes: toJson({ viewOnly: false, syncMasterData: false, allowRedemption: false, allowEdit: false, ownerApprovalRequired: true }),
      overridePolicy: toJson(defaultOverridePolicy(item.key)),
      createdAt: stamp,
      updatedAt: stamp
    });
  }
}

function defaultOverridePolicy(module) {
  if (module === "product") return { catalogShared: true, stockBranchScoped: true };
  if (module === "service") return { catalogShared: true, priceBranchOverride: true };
  if (module === "membership" || module === "package") return { redemptionControlledByBranchRule: true };
  return { policyFirst: true };
}

function branches(access) {
  return db.prepare(`
    SELECT id, name, city, address, phone, status
    FROM branches
    WHERE tenantId = @tenantId
    ORDER BY name COLLATE NOCASE ASC
    LIMIT 1000
  `).all({ tenantId: access.tenantId });
}

function settings(access) {
  ensureDefaultSettings(access);
  return db.prepare(`
    SELECT * FROM locationSharingSettings
    WHERE tenantId = @tenantId
    ORDER BY module ASC
  `).all({ tenantId: access.tenantId }).map(mapSetting);
}

function rules(access, query = {}) {
  const params = { tenantId: access.tenantId, limit: Math.min(500, Math.max(1, Number(query.limit || 200))) };
  const filters = ["tenantId = @tenantId"];
  if (query.module) {
    moduleDefinition(query.module);
    filters.push("module = @module");
    params.module = text(query.module).toLowerCase();
  }
  if (query.sourceBranchId) {
    assertBranch(access, query.sourceBranchId);
    filters.push("sourceBranchId = @sourceBranchId");
    params.sourceBranchId = text(query.sourceBranchId);
  }
  return db.prepare(`
    SELECT * FROM locationSharingRules
    WHERE ${filters.join(" AND ")}
    ORDER BY updatedAt DESC
    LIMIT @limit
  `).all(params).map(mapRule);
}

function approvals(access, query = {}) {
  const status = text(query.status || "");
  const params = { tenantId: access.tenantId, limit: Math.min(500, Math.max(1, Number(query.limit || 200))) };
  const filters = ["tenantId = @tenantId"];
  if (status) {
    filters.push("status = @status");
    params.status = status;
  }
  return db.prepare(`
    SELECT * FROM locationSharingApprovals
    WHERE ${filters.join(" AND ")}
    ORDER BY requestedAt DESC
    LIMIT @limit
  `).all(params).map(mapApproval);
}

function events(access, query = {}) {
  const params = { tenantId: access.tenantId, limit: Math.min(500, Math.max(1, Number(query.limit || 200))) };
  const filters = ["tenantId = @tenantId"];
  if (query.module) {
    moduleDefinition(query.module);
    filters.push("module = @module");
    params.module = text(query.module).toLowerCase();
  }
  return db.prepare(`
    SELECT * FROM locationSharingEvents
    WHERE ${filters.join(" AND ")}
    ORDER BY createdAt DESC
    LIMIT @limit
  `).all(params).map(mapEvent);
}

function upsertConflict(access, conflictPayload) {
  const existing = db.prepare(`
    SELECT * FROM locationSharingConflicts
    WHERE tenantId = @tenantId AND conflictKey = @conflictKey
  `).get({ tenantId: access.tenantId, conflictKey: conflictPayload.conflictKey });
  const stamp = now();
  const row = {
    id: existing?.id || id("lshare_conf"),
    tenantId: access.tenantId,
    branchId: conflictPayload.sourceBranchId || "",
    conflictKey: conflictPayload.conflictKey,
    conflictType: conflictPayload.conflictType,
    module: conflictPayload.module,
    sourceBranchId: conflictPayload.sourceBranchId || "",
    targetBranchId: conflictPayload.targetBranchId || "",
    summary: conflictPayload.summary,
    evidence: toJson(conflictPayload.evidence || {}),
    resolution: existing?.resolution || toJson({}),
    approvalStatus: existing?.approvalStatus || "not_required",
    status: existing?.status && existing.status !== "resolved" ? existing.status : "open",
    createdAt: existing?.createdAt || stamp,
    updatedAt: stamp
  };
  db.prepare(`
    INSERT INTO locationSharingConflicts
      (id, tenantId, branchId, conflictKey, conflictType, module, sourceBranchId, targetBranchId, summary, evidence, resolution, approvalStatus, status, createdAt, updatedAt)
    VALUES
      (@id, @tenantId, @branchId, @conflictKey, @conflictType, @module, @sourceBranchId, @targetBranchId, @summary, @evidence, @resolution, @approvalStatus, @status, @createdAt, @updatedAt)
    ON CONFLICT(tenantId, conflictKey) DO UPDATE SET
      summary = excluded.summary,
      evidence = excluded.evidence,
      updatedAt = excluded.updatedAt
  `).run(row);
  return row;
}

function detectCustomerConflicts(access) {
  if (!tableExists("clients")) return [];
  return db.prepare(`
    SELECT lower(COALESCE(NULLIF(phone, ''), NULLIF(email, ''))) AS matchKey,
           COUNT(DISTINCT branchId) AS branchCount,
           group_concat(DISTINCT branchId) AS branches,
           group_concat(name) AS names
    FROM clients
    WHERE tenantId = @tenantId
      AND COALESCE(NULLIF(phone, ''), NULLIF(email, '')) <> ''
    GROUP BY matchKey
    HAVING branchCount > 1
    LIMIT 100
  `).all({ tenantId: access.tenantId }).map((row) => upsertConflict(access, {
    conflictKey: `customer:${row.matchKey}`,
    conflictType: "duplicate_customer",
    module: "customer",
    summary: `Duplicate customer identity across ${row.branchCount} branches`,
    evidence: { branches: text(row.branches).split(","), names: text(row.names).split(",") }
  }));
}

function detectServiceConflicts(access) {
  if (!tableExists("services") || !hasColumn("services", "branchId")) return [];
  return db.prepare(`
    SELECT lower(name) AS matchKey,
           COUNT(DISTINCT branchId) AS branchCount,
           COUNT(DISTINCT price) AS priceCount,
           group_concat(DISTINCT branchId) AS branches,
           group_concat(DISTINCT price) AS prices
    FROM services
    WHERE tenantId = @tenantId AND COALESCE(name, '') <> ''
    GROUP BY matchKey
    HAVING branchCount > 1 AND priceCount > 1
    LIMIT 100
  `).all({ tenantId: access.tenantId }).map((row) => upsertConflict(access, {
    conflictKey: `service:${row.matchKey}`,
    conflictType: "service_price_mismatch",
    module: "service",
    summary: "Same service has different branch prices",
    evidence: { branches: text(row.branches).split(","), prices: text(row.prices).split(",") }
  }));
}

function detectProductConflicts(access) {
  if (!tableExists("products")) return [];
  return db.prepare(`
    SELECT lower(COALESCE(NULLIF(sku, ''), name)) AS matchKey,
           COUNT(DISTINCT branchId) AS branchCount,
           COUNT(DISTINCT price) AS priceCount,
           group_concat(DISTINCT branchId) AS branches,
           group_concat(DISTINCT name) AS names
    FROM products
    WHERE tenantId = @tenantId AND COALESCE(NULLIF(sku, ''), name) <> ''
    GROUP BY matchKey
    HAVING branchCount > 1 AND (priceCount > 1 OR COUNT(DISTINCT name) > 1)
    LIMIT 100
  `).all({ tenantId: access.tenantId }).map((row) => upsertConflict(access, {
    conflictKey: `product:${row.matchKey}`,
    conflictType: "product_catalog_mismatch",
    module: "product",
    summary: "Product catalog differs across branches",
    evidence: { branches: text(row.branches).split(","), names: text(row.names).split(",") }
  }));
}

function detectVendorConflicts(access) {
  if (!tableExists("suppliers") || !hasColumn("suppliers", "branchId")) return [];
  const phoneColumn = hasColumn("suppliers", "phone") ? "phone" : hasColumn("suppliers", "contact") ? "contact" : "''";
  return db.prepare(`
    SELECT lower(COALESCE(NULLIF(${phoneColumn}, ''), name)) AS matchKey,
           COUNT(DISTINCT branchId) AS branchCount,
           group_concat(DISTINCT branchId) AS branches,
           group_concat(DISTINCT name) AS names
    FROM suppliers
    WHERE tenantId = @tenantId AND COALESCE(name, '') <> ''
    GROUP BY matchKey
    HAVING branchCount > 1
    LIMIT 100
  `).all({ tenantId: access.tenantId }).map((row) => upsertConflict(access, {
    conflictKey: `vendor:${row.matchKey}`,
    conflictType: "vendor_duplicate_or_mismatch",
    module: "vendor",
    summary: "Vendor appears in multiple branches",
    evidence: { branches: text(row.branches).split(","), names: text(row.names).split(",") }
  }));
}

function scanConflicts(access) {
  return [
    ...detectCustomerConflicts(access),
    ...detectServiceConflicts(access),
    ...detectProductConflicts(access),
    ...detectVendorConflicts(access)
  ];
}

function conflicts(access, query = {}) {
  scanConflicts(access);
  const params = { tenantId: access.tenantId, limit: Math.min(500, Math.max(1, Number(query.limit || 200))) };
  const filters = ["tenantId = @tenantId"];
  if (query.status) {
    filters.push("status = @status");
    params.status = text(query.status);
  }
  if (query.module) {
    moduleDefinition(query.module);
    filters.push("module = @module");
    params.module = text(query.module).toLowerCase();
  }
  return db.prepare(`
    SELECT * FROM locationSharingConflicts
    WHERE ${filters.join(" AND ")}
    ORDER BY updatedAt DESC
    LIMIT @limit
  `).all(params).map(mapConflict);
}

function countTable(table, access) {
  if (!tableExists(table)) return 0;
  const filters = ["tenantId = @tenantId"];
  const params = { tenantId: access.tenantId };
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${filters.join(" AND ")}`).get(params)?.count || 0);
}

class LocationSharingService {
  overview(query = {}, access = {}) {
    accessScope(access);
    const allSettings = settings(access);
    const activeRules = rules(access, query);
    const openConflicts = conflicts(access, { ...query, status: "open", limit: 50 });
    const pendingApprovals = approvals(access, { status: "pending", limit: 50 });
    const recentEvents = events(access, { limit: 50 });
    const branchRows = branches(access);
    const reports = this.reports(query, access);
    return {
      modules: MODULES,
      modeKeys: MODE_KEYS,
      settings: allSettings,
      rules: activeRules,
      branches: branchRows,
      conflicts: openConflicts,
      approvals: pendingApprovals,
      events: recentEvents,
      reports,
      summary: {
        enabledModules: allSettings.filter((item) => item.enabled).length,
        rules: activeRules.length,
        branches: branchRows.length,
        openConflicts: openConflicts.length,
        pendingApprovals: pendingApprovals.length,
        lastEventAt: recentEvents[0]?.createdAt || ""
      }
    };
  }

  updateSettings(payload = {}, access = {}) {
    assertOwner(access);
    ensureDefaultSettings(access);
    const incoming = Array.isArray(payload.settings) ? payload.settings : [];
    if (!incoming.length) throw badRequest("settings array is required");
    const before = settings(access);
    const stamp = now();
    const saved = [];
    for (const setting of incoming) {
      const module = moduleDefinition(setting.module).key;
      const modes = normalizeModes(setting.modes || {}, { forceOwnerApproval: true });
      const overridePolicy = { ...defaultOverridePolicy(module), ...readJson(setting.overridePolicy, {}) };
      db.prepare(`
        UPDATE locationSharingSettings
        SET enabled = @enabled,
            modes = @modes,
            overridePolicy = @overridePolicy,
            updatedAt = @updatedAt
        WHERE tenantId = @tenantId AND branchId = '' AND module = @module
      `).run({
        tenantId: access.tenantId,
        module,
        enabled: boolInt(setting.enabled),
        modes: toJson(modes),
        overridePolicy: toJson(overridePolicy),
        updatedAt: stamp
      });
      saved.push(module);
    }
    const after = settings(access);
    insertEvent(access, {
      action: "location_sharing.settings_updated",
      entityType: "locationSharingSettings",
      beforePayload: { settings: before },
      afterPayload: { settings: after, saved }
    });
    return { settings: after };
  }

  upsertRules(payload = {}, access = {}) {
    assertOwner(access);
    const incoming = Array.isArray(payload.rules) ? payload.rules : [payload];
    if (!incoming.length) throw badRequest("rules payload is required");
    const saved = [];
    for (const rule of incoming) {
      const module = moduleDefinition(rule.module).key;
      const sourceBranchId = text(rule.sourceBranchId);
      const targetBranchId = text(rule.targetBranchId);
      if (!sourceBranchId || !targetBranchId) throw badRequest("sourceBranchId and targetBranchId are required");
      if (sourceBranchId === targetBranchId) throw badRequest("source and target branch must be different");
      assertBranch(access, sourceBranchId);
      assertBranch(access, targetBranchId);
      const modes = normalizeModes(rule.modes || {}, { forceOwnerApproval: true });
      const risky = isRisky(modes);
      const stamp = now();
      const existing = db.prepare(`
        SELECT * FROM locationSharingRules
        WHERE tenantId = @tenantId AND sourceBranchId = @sourceBranchId AND targetBranchId = @targetBranchId AND module = @module
      `).get({ tenantId: access.tenantId, sourceBranchId, targetBranchId, module });
      const row = {
        id: existing?.id || id("lshare_rule"),
        tenantId: access.tenantId,
        branchId: sourceBranchId,
        sourceBranchId,
        targetBranchId,
        module,
        modes: toJson(modes),
        overridePolicy: toJson({ ...defaultOverridePolicy(module), ...readJson(rule.overridePolicy, {}) }),
        approvalStatus: risky ? "pending" : "not_required",
        status: risky ? "pending_approval" : "active",
        createdBy: existing?.createdBy || access.userId || "",
        approvedBy: risky ? "" : access.userId || "",
        approvedAt: risky ? "" : stamp,
        createdAt: existing?.createdAt || stamp,
        updatedAt: stamp
      };
      db.prepare(`
        INSERT INTO locationSharingRules
          (id, tenantId, branchId, sourceBranchId, targetBranchId, module, modes, overridePolicy, approvalStatus, status, createdBy, approvedBy, approvedAt, createdAt, updatedAt)
        VALUES
          (@id, @tenantId, @branchId, @sourceBranchId, @targetBranchId, @module, @modes, @overridePolicy, @approvalStatus, @status, @createdBy, @approvedBy, @approvedAt, @createdAt, @updatedAt)
        ON CONFLICT(tenantId, sourceBranchId, targetBranchId, module) DO UPDATE SET
          modes = excluded.modes,
          overridePolicy = excluded.overridePolicy,
          approvalStatus = excluded.approvalStatus,
          status = excluded.status,
          approvedBy = excluded.approvedBy,
          approvedAt = excluded.approvedAt,
          updatedAt = excluded.updatedAt
      `).run(row);
      insertEvent(access, {
        action: "location_sharing.rule_saved",
        module,
        sourceBranchId,
        targetBranchId,
        entityType: "locationSharingRules",
        entityId: row.id,
        beforePayload: existing ? mapRule(existing) : {},
        afterPayload: mapRule(row),
        status: row.status
      });
      if (risky) {
        createApproval(access, {
          requestType: "rule_activation",
          module,
          sourceBranchId,
          targetBranchId,
          relatedType: "locationSharingRules",
          relatedId: row.id,
          payload: mapRule(row)
        });
      }
      saved.push(mapRule(row));
    }
    return { rules: saved, approvals: approvals(access, { status: "pending", limit: 100 }) };
  }

  conflicts(query = {}, access = {}) {
    accessScope(access);
    return { conflicts: conflicts(access, query) };
  }

  resolveConflict(conflictId, payload = {}, access = {}) {
    assertOwner(access);
    const conflict = db.prepare(`
      SELECT * FROM locationSharingConflicts
      WHERE id = @id AND tenantId = @tenantId
    `).get({ id: conflictId, tenantId: access.tenantId });
    if (!conflict) throw notFound("Conflict not found");
    const action = text(payload.action || "ignore");
    const risky = ["merge", "branch_override", "sync_master"].includes(action);
    const stamp = now();
    const next = {
      resolution: toJson({ action, note: text(payload.note), decidedBy: access.userId || "", decidedAt: stamp }),
      approvalStatus: risky ? "pending" : "not_required",
      status: risky ? "pending_approval" : "resolved",
      updatedAt: stamp,
      id: conflict.id,
      tenantId: access.tenantId
    };
    db.prepare(`
      UPDATE locationSharingConflicts
      SET resolution = @resolution,
          approvalStatus = @approvalStatus,
          status = @status,
          updatedAt = @updatedAt
      WHERE id = @id AND tenantId = @tenantId
    `).run(next);
    const updated = db.prepare("SELECT * FROM locationSharingConflicts WHERE id = @id AND tenantId = @tenantId").get(next);
    insertEvent(access, {
      action: "location_sharing.conflict_resolution_requested",
      module: conflict.module,
      sourceBranchId: conflict.sourceBranchId,
      targetBranchId: conflict.targetBranchId,
      entityType: "locationSharingConflicts",
      entityId: conflict.id,
      beforePayload: mapConflict(conflict),
      afterPayload: mapConflict(updated),
      status: next.status
    });
    const approval = risky ? createApproval(access, {
      requestType: "conflict_resolution",
      module: conflict.module,
      sourceBranchId: conflict.sourceBranchId,
      targetBranchId: conflict.targetBranchId,
      relatedType: "locationSharingConflicts",
      relatedId: conflict.id,
      payload: mapConflict(updated)
    }) : null;
    return { conflict: mapConflict(updated), approval };
  }

  approvals(query = {}, access = {}) {
    accessScope(access);
    return { approvals: approvals(access, query) };
  }

  decideApproval(approvalId, decision, payload = {}, access = {}) {
    assertOwner(access);
    const approval = db.prepare(`
      SELECT * FROM locationSharingApprovals
      WHERE id = @id AND tenantId = @tenantId
    `).get({ id: approvalId, tenantId: access.tenantId });
    if (!approval) throw notFound("Approval not found");
    if (approval.status !== "pending") throw badRequest("Approval already decided");
    const status = decision === "approved" ? "approved" : "rejected";
    const stamp = now();
    db.prepare(`
      UPDATE locationSharingApprovals
      SET status = @status,
          decidedBy = @decidedBy,
          decisionNote = @decisionNote,
          decidedAt = @decidedAt
      WHERE id = @id AND tenantId = @tenantId
    `).run({
      id: approval.id,
      tenantId: access.tenantId,
      status,
      decidedBy: access.userId || "",
      decisionNote: text(payload.note),
      decidedAt: stamp
    });
    if (approval.relatedType === "locationSharingRules") {
      db.prepare(`
        UPDATE locationSharingRules
        SET approvalStatus = @approvalStatus,
            status = @ruleStatus,
            approvedBy = @approvedBy,
            approvedAt = @approvedAt,
            updatedAt = @updatedAt
        WHERE id = @id AND tenantId = @tenantId
      `).run({
        id: approval.relatedId,
        tenantId: access.tenantId,
        approvalStatus: status,
        ruleStatus: status === "approved" ? "active" : "rejected",
        approvedBy: status === "approved" ? access.userId || "" : "",
        approvedAt: status === "approved" ? stamp : "",
        updatedAt: stamp
      });
    }
    if (approval.relatedType === "locationSharingConflicts") {
      db.prepare(`
        UPDATE locationSharingConflicts
        SET approvalStatus = @approvalStatus,
            status = @conflictStatus,
            updatedAt = @updatedAt
        WHERE id = @id AND tenantId = @tenantId
      `).run({
        id: approval.relatedId,
        tenantId: access.tenantId,
        approvalStatus: status,
        conflictStatus: status === "approved" ? "resolved" : "open",
        updatedAt: stamp
      });
    }
    const updated = db.prepare("SELECT * FROM locationSharingApprovals WHERE id = @id AND tenantId = @tenantId").get({ id: approval.id, tenantId: access.tenantId });
    insertEvent(access, {
      action: `location_sharing.approval_${status}`,
      module: approval.module,
      sourceBranchId: approval.sourceBranchId,
      targetBranchId: approval.targetBranchId,
      entityType: approval.relatedType,
      entityId: approval.relatedId,
      beforePayload: mapApproval(approval),
      afterPayload: mapApproval(updated),
      status
    });
    return { approval: mapApproval(updated) };
  }

  events(query = {}, access = {}) {
    accessScope(access);
    return { events: events(access, query) };
  }

  reports(_query = {}, access = {}) {
    accessScope(access);
    const allSettings = settings(access);
    const openConflicts = db.prepare("SELECT COUNT(*) AS count FROM locationSharingConflicts WHERE tenantId = @tenantId AND status = 'open'").get({ tenantId: access.tenantId })?.count || 0;
    const pendingApprovals = db.prepare("SELECT COUNT(*) AS count FROM locationSharingApprovals WHERE tenantId = @tenantId AND status = 'pending'").get({ tenantId: access.tenantId })?.count || 0;
    const failedSync = db.prepare("SELECT COUNT(*) AS count FROM locationSharingEvents WHERE tenantId = @tenantId AND status = 'failed'").get({ tenantId: access.tenantId })?.count || 0;
    const lastEvent = db.prepare("SELECT createdAt FROM locationSharingEvents WHERE tenantId = @tenantId ORDER BY createdAt DESC LIMIT 1").get({ tenantId: access.tenantId });
    return {
      summary: {
        customerMovement: countTable("clients", access),
        membershipRedemption: countTable("memberships", access),
        packageUsage: countTable("packages", access),
        syncHealth: failedSync ? "attention" : "healthy",
        enabledModules: allSettings.filter((item) => item.enabled).length,
        pendingChanges: pendingApprovals,
        openConflicts,
        failedSyncCount: failedSync,
        lastSyncedAt: lastEvent?.createdAt || ""
      },
      cards: [
        { key: "customerMovement", label: "Cross-branch customer movement", value: countTable("clients", access), detail: "Customer identities available for duplicate and movement control" },
        { key: "membershipRedemption", label: "Membership redemption", value: countTable("memberships", access), detail: "Policy-gated cross-branch redemption candidates" },
        { key: "packageUsage", label: "Package usage", value: countTable("packages", access), detail: "Package catalog rows governed by sharing rules" },
        { key: "syncHealth", label: "Sync health", value: failedSync ? failedSync : "OK", detail: failedSync ? "Failed policy events need review" : "No failed sharing events" }
      ]
    };
  }
}

export const locationSharingService = new LocationSharingService();
