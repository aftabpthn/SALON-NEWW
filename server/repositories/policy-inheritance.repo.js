import { db } from "../db.js";
import { orgHierarchyRepo } from "./org-hierarchy.repo.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS discountPolicies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    scopeType TEXT NOT NULL,
    scopeId TEXT NOT NULL,
    name TEXT NOT NULL,
    maxDiscountPercent INTEGER DEFAULT NULL,
    maxFlatDiscountPaise INTEGER DEFAULT NULL,
    stackableAllowed INTEGER DEFAULT NULL,
    approvalRequiredAbovePercent INTEGER DEFAULT NULL,
    minMarginPercent INTEGER DEFAULT NULL,
    budgetRequired INTEGER DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    metadataJson TEXT NOT NULL DEFAULT '{}',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, scopeType, scopeId)
  );

  CREATE TABLE IF NOT EXISTS policyOverrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    targetBranchId TEXT NOT NULL,
    orgUnitId INTEGER DEFAULT NULL,
    overrideJson TEXT NOT NULL DEFAULT '{}',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId, targetBranchId)
  );

  CREATE INDEX IF NOT EXISTS idx_discountPolicies_scope ON discountPolicies(tenantId, branchId, scopeType, scopeId, status);
  CREATE INDEX IF NOT EXISTS idx_policyOverrides_scope ON policyOverrides(tenantId, branchId, status);
  CREATE INDEX IF NOT EXISTS idx_policyOverrides_target ON policyOverrides(tenantId, branchId, targetBranchId, status);
`);

const scopeTypes = new Set(["tenant", "org_unit", "branch"]);
const statuses = new Set(["active", "paused", "archived"]);
const policyFields = [
  "maxDiscountPercent",
  "maxFlatDiscountPaise",
  "stackableAllowed",
  "approvalRequiredAbovePercent",
  "minMarginPercent",
  "budgetRequired"
];

const statements = {
  upsertPolicy: db.prepare(`
    INSERT INTO discountPolicies (
      tenantId, branchId, scopeType, scopeId, name, maxDiscountPercent,
      maxFlatDiscountPaise, stackableAllowed, approvalRequiredAbovePercent,
      minMarginPercent, budgetRequired, status, metadataJson, createdBy
    )
    VALUES (
      @tenantId, @branchId, @scopeType, @scopeId, @name, @maxDiscountPercent,
      @maxFlatDiscountPaise, @stackableAllowed, @approvalRequiredAbovePercent,
      @minMarginPercent, @budgetRequired, @status, @metadataJson, @createdBy
    )
    ON CONFLICT(tenantId, branchId, scopeType, scopeId)
    DO UPDATE SET
      name = excluded.name,
      maxDiscountPercent = excluded.maxDiscountPercent,
      maxFlatDiscountPaise = excluded.maxFlatDiscountPaise,
      stackableAllowed = excluded.stackableAllowed,
      approvalRequiredAbovePercent = excluded.approvalRequiredAbovePercent,
      minMarginPercent = excluded.minMarginPercent,
      budgetRequired = excluded.budgetRequired,
      status = excluded.status,
      metadataJson = excluded.metadataJson,
      updatedAt = strftime('%s','now')
  `),
  getPolicyByScope: db.prepare(`
    SELECT * FROM discountPolicies
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND scopeType = @scopeType
      AND scopeId = @scopeId
      AND status = 'active'
    ORDER BY updatedAt DESC, id DESC
    LIMIT 1
  `),
  upsertOverride: db.prepare(`
    INSERT INTO policyOverrides (
      tenantId, branchId, targetBranchId, orgUnitId, overrideJson, reason, status, createdBy
    )
    VALUES (
      @tenantId, @branchId, @targetBranchId, @orgUnitId, @overrideJson, @reason, @status, @createdBy
    )
    ON CONFLICT(tenantId, branchId, targetBranchId)
    DO UPDATE SET
      orgUnitId = excluded.orgUnitId,
      overrideJson = excluded.overrideJson,
      reason = excluded.reason,
      status = excluded.status,
      updatedAt = strftime('%s','now')
  `),
  getOverride: db.prepare(`
    SELECT * FROM policyOverrides
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND targetBranchId = @targetBranchId
      AND status = 'active'
    LIMIT 1
  `),
  listOverrides: db.prepare(`
    SELECT * FROM policyOverrides
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND (@status IS NULL OR status = @status)
      AND (@targetBranchId IS NULL OR targetBranchId = @targetBranchId)
    ORDER BY updatedAt DESC, id DESC
    LIMIT @limit
  `)
};

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {});
}

function nullablePercent(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const percent = Number.parseInt(value, 10);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new Error(`${field} must be between 0 and 100`);
  }
  return percent;
}

function nullablePaise(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${field} must be integer paise`);
  return amount;
}

function nullableBool(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === 1 || value === "1" || value === "true") return 1;
  if (value === 0 || value === "0" || value === "false") return 0;
  return Boolean(value) ? 1 : 0;
}

function normalizeStatus(value) {
  const status = String(value || "active").trim();
  return statuses.has(status) ? status : "active";
}

function normalizeScope(data = {}) {
  const current = requireScope(data);
  const scopeType = String(data.scopeType || "branch").trim();
  if (!scopeTypes.has(scopeType)) throw new Error("scopeType must be tenant, org_unit or branch");
  const scopeId = String(
    scopeType === "tenant"
      ? current.tenantId
      : data.scopeId || data.orgUnitId || data.targetBranchId || current.branchId
  ).trim();
  if (!scopeId) throw new Error("scopeId is required");
  return { ...current, scopeType, scopeId };
}

function policyPayload(data = {}) {
  const scope = normalizeScope(data);
  const policy = data.policy && typeof data.policy === "object" ? data.policy : data;
  return {
    ...scope,
    name: String(data.name || policy.name || `${scope.scopeType} discount policy`).trim(),
    maxDiscountPercent: nullablePercent(policy.maxDiscountPercent, "maxDiscountPercent"),
    maxFlatDiscountPaise: nullablePaise(policy.maxFlatDiscountPaise, "maxFlatDiscountPaise"),
    stackableAllowed: nullableBool(policy.stackableAllowed),
    approvalRequiredAbovePercent: nullablePercent(policy.approvalRequiredAbovePercent, "approvalRequiredAbovePercent"),
    minMarginPercent: nullablePercent(policy.minMarginPercent, "minMarginPercent"),
    budgetRequired: nullableBool(policy.budgetRequired),
    status: normalizeStatus(data.status || policy.status),
    metadataJson: json(data.metadata || policy.metadata || {}),
    createdBy: data.createdBy || null
  };
}

function overridePayload(data = {}) {
  const current = requireScope(data);
  const override = data.override && typeof data.override === "object"
    ? data.override
    : data.policy && typeof data.policy === "object"
      ? data.policy
      : data;
  const targetBranchId = String(data.targetBranchId || data.assignedBranchId || current.branchId).trim();
  if (!targetBranchId) throw new Error("targetBranchId is required");
  const normalizedOverride = {};
  for (const field of policyFields) {
    if (override[field] !== undefined) {
      normalizedOverride[field] = field.endsWith("Paise")
        ? nullablePaise(override[field], field)
        : field === "stackableAllowed" || field === "budgetRequired"
          ? Boolean(nullableBool(override[field]))
          : nullablePercent(override[field], field);
    }
  }
  return {
    ...current,
    targetBranchId,
    orgUnitId: data.orgUnitId === undefined || data.orgUnitId === null || data.orgUnitId === ""
      ? null
      : Number.parseInt(data.orgUnitId, 10),
    overrideJson: json(normalizedOverride),
    reason: String(data.reason || "").trim(),
    status: normalizeStatus(data.status),
    createdBy: data.createdBy || null
  };
}

function policyFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: parseJson(row.metadataJson, {}),
    stackableAllowed: row.stackableAllowed === null ? null : Boolean(row.stackableAllowed),
    budgetRequired: row.budgetRequired === null ? null : Boolean(row.budgetRequired)
  };
}

function overrideFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    override: parseJson(row.overrideJson, {})
  };
}

function mergePolicy(effective, policy, source) {
  if (!policy) return effective;
  const next = { ...effective, sources: [...effective.sources] };
  for (const field of policyFields) {
    if (policy[field] !== null && policy[field] !== undefined) {
      next[field] = policy[field];
      next.sources.push({ field, ...source });
    }
  }
  return next;
}

function emptyPolicy() {
  return {
    maxDiscountPercent: null,
    maxFlatDiscountPaise: null,
    stackableAllowed: null,
    approvalRequiredAbovePercent: null,
    minMarginPercent: null,
    budgetRequired: null,
    sources: []
  };
}

function safeOrgPath(scope) {
  try {
    return orgHierarchyRepo.getBranchOrgPath(scope);
  } catch {
    return [];
  }
}

export function setPolicy(data = {}) {
  const payload = policyPayload(data);
  statements.upsertPolicy.run(payload);
  return policyFromRow(statements.getPolicyByScope.get(payload));
}

export function resolvePolicyChain(scope = {}) {
  const current = requireScope(scope);
  const targetBranchId = String(scope.targetBranchId || current.branchId).trim();
  if (!targetBranchId) throw new Error("targetBranchId is required");
  const orgPath = safeOrgPath({ tenantId: current.tenantId, branchId: targetBranchId });
  const entries = [
    { scopeType: "tenant", scopeId: current.tenantId, label: "Tenant default" },
    ...orgPath.map((unit) => ({
      scopeType: "org_unit",
      scopeId: String(unit.id),
      label: unit.name,
      orgUnit: unit
    })),
    { scopeType: "branch", scopeId: targetBranchId, label: "Branch policy" }
  ];

  let effectivePolicy = emptyPolicy();
  const chain = entries.map((entry) => {
    const policy = policyFromRow(statements.getPolicyByScope.get({
      tenantId: current.tenantId,
      branchId: current.branchId,
      scopeType: entry.scopeType,
      scopeId: entry.scopeId
    }));
    effectivePolicy = mergePolicy(effectivePolicy, policy, {
      scopeType: entry.scopeType,
      scopeId: entry.scopeId,
      policyId: policy?.id || null
    });
    return { ...entry, policy };
  });

  const override = overrideFromRow(statements.getOverride.get({
    tenantId: current.tenantId,
    branchId: current.branchId,
    targetBranchId
  }));
  if (override?.override) {
    effectivePolicy = mergePolicy(effectivePolicy, override.override, {
      scopeType: "branch_override",
      scopeId: targetBranchId,
      overrideId: override.id
    });
  }

  return {
    tenantId: current.tenantId,
    branchId: current.branchId,
    targetBranchId,
    orgPath,
    chain,
    override,
    effectivePolicy
  };
}

export function getEffectivePolicy(scope = {}) {
  return resolvePolicyChain(scope).effectivePolicy;
}

export function listOverrides(scope = {}) {
  const current = requireScope(scope);
  const status = scope.status ? normalizeStatus(scope.status) : null;
  const targetBranchId = scope.targetBranchId ? String(scope.targetBranchId).trim() : null;
  const limit = Math.min(100, Math.max(1, Number.parseInt(scope.limit, 10) || 50));
  return statements.listOverrides.all({ ...current, status, targetBranchId, limit }).map(overrideFromRow);
}

export function setOverride(data = {}) {
  const payload = overridePayload(data);
  if (payload.orgUnitId !== null && (!Number.isInteger(payload.orgUnitId) || payload.orgUnitId <= 0)) {
    throw new Error("orgUnitId must be a positive integer");
  }
  statements.upsertOverride.run(payload);
  return overrideFromRow(statements.getOverride.get(payload));
}

export const policyInheritanceRepo = {
  setPolicy,
  getEffectivePolicy,
  listOverrides,
  resolvePolicyChain,
  setOverride
};
