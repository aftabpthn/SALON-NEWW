import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS orgUnits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    parentId INTEGER DEFAULT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'region',
    externalCode TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS branchAssignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    orgUnitId INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    assignedBy TEXT DEFAULT NULL,
    assignedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId)
  );

  CREATE INDEX IF NOT EXISTS idx_orgUnits_scope ON orgUnits(tenantId, branchId, status);
  CREATE INDEX IF NOT EXISTS idx_orgUnits_parent ON orgUnits(tenantId, branchId, parentId);
  CREATE INDEX IF NOT EXISTS idx_branchAssignments_scope ON branchAssignments(tenantId, branchId, status);
  CREATE INDEX IF NOT EXISTS idx_branchAssignments_unit ON branchAssignments(tenantId, orgUnitId, status);
`);

const unitTypes = new Set(["company", "region", "zone", "cluster", "area", "branch_group"]);
const statuses = new Set(["active", "paused", "archived"]);

const statements = {
  insertUnit: db.prepare(`
    INSERT INTO orgUnits (tenantId, branchId, parentId, name, type, externalCode, status, createdBy)
    VALUES (@tenantId, @branchId, @parentId, @name, @type, @externalCode, @status, @createdBy)
  `),
  updateUnit: db.prepare(`
    UPDATE orgUnits
    SET parentId = @parentId,
        name = @name,
        type = @type,
        externalCode = @externalCode,
        status = @status,
        updatedAt = strftime('%s','now')
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
  `),
  getUnit: db.prepare(`
    SELECT * FROM orgUnits
    WHERE id = @id
      AND tenantId = @tenantId
      AND branchId = @branchId
    LIMIT 1
  `),
  getTenantUnit: db.prepare(`
    SELECT * FROM orgUnits
    WHERE id = @id
      AND tenantId = @tenantId
    LIMIT 1
  `),
  listUnits: db.prepare(`
    SELECT * FROM orgUnits
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status != 'archived'
    ORDER BY parentId IS NOT NULL, parentId, name COLLATE NOCASE, id
  `),
  assignmentsForScope: db.prepare(`
    SELECT * FROM branchAssignments
    WHERE tenantId = @tenantId
      AND orgUnitId IN (SELECT id FROM orgUnits WHERE tenantId = @tenantId AND branchId = @branchId)
      AND status = 'active'
    ORDER BY branchId COLLATE NOCASE
  `),
  upsertAssignment: db.prepare(`
    INSERT INTO branchAssignments (tenantId, branchId, orgUnitId, status, assignedBy)
    VALUES (@tenantId, @branchId, @orgUnitId, @status, @assignedBy)
    ON CONFLICT(tenantId, branchId)
    DO UPDATE SET
      orgUnitId = excluded.orgUnitId,
      status = excluded.status,
      assignedBy = excluded.assignedBy,
      updatedAt = strftime('%s','now')
  `),
  getAssignment: db.prepare(`
    SELECT * FROM branchAssignments
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND status = 'active'
    LIMIT 1
  `)
};

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function intId(value, field = "id") {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${field} must be a positive integer`);
  return id;
}

function nullableIntId(value, field = "parentId") {
  if (value === undefined || value === null || value === "") return null;
  return intId(value, field);
}

function normalizeType(value) {
  const type = String(value || "region").trim();
  return unitTypes.has(type) ? type : "region";
}

function normalizeStatus(value) {
  const status = String(value || "active").trim();
  return statuses.has(status) ? status : "active";
}

function normalizeUnit(data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("name is required");
  return {
    ...requireScope(data),
    parentId: nullableIntId(data.parentId),
    name,
    type: normalizeType(data.type),
    externalCode: String(data.externalCode || "").trim(),
    status: normalizeStatus(data.status),
    createdBy: data.createdBy || null
  };
}

function unitById(scope = {}, idValue = scope.id) {
  return statements.getUnit.get({ ...requireScope(scope), id: intId(idValue) });
}

function assertParent(scope, parentId, unitId = null) {
  if (!parentId) return;
  if (unitId && parentId === unitId) throw new Error("parentId cannot match unit id");
  const parent = unitById(scope, parentId);
  if (!parent) throw new Error("parent org unit not found");
}

function assertNoCycle(scope, id, parentId) {
  let currentParentId = parentId;
  const seen = new Set([id]);
  for (let depth = 0; currentParentId && depth < 25; depth += 1) {
    if (seen.has(currentParentId)) throw new Error("org hierarchy cycle detected");
    seen.add(currentParentId);
    const parent = unitById(scope, currentParentId);
    currentParentId = parent?.parentId || null;
  }
}

function decorateUnits(units, assignments) {
  const assignmentMap = new Map();
  for (const assignment of assignments) {
    const existing = assignmentMap.get(assignment.orgUnitId) || [];
    existing.push({
      branchId: assignment.branchId,
      status: assignment.status,
      assignedBy: assignment.assignedBy,
      assignedAt: assignment.assignedAt,
      updatedAt: assignment.updatedAt
    });
    assignmentMap.set(assignment.orgUnitId, existing);
  }
  return units.map((unit) => ({
    ...unit,
    assignedBranches: assignmentMap.get(unit.id) || [],
    children: []
  }));
}

function buildTree(units) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const roots = [];
  for (const unit of units) {
    if (unit.parentId && byId.has(unit.parentId)) {
      byId.get(unit.parentId).children.push(unit);
    } else {
      roots.push(unit);
    }
  }
  return roots;
}

export function createOrgUnit(data = {}) {
  const payload = normalizeUnit(data);
  assertParent(payload, payload.parentId);
  const result = statements.insertUnit.run(payload);
  return unitById(payload, result.lastInsertRowid);
}

export function updateOrgUnit(data = {}) {
  const scope = requireScope(data);
  const id = intId(data.id);
  const existing = unitById(scope, id);
  if (!existing) throw new Error("org unit not found");

  const payload = {
    ...scope,
    id,
    parentId: data.parentId === undefined ? existing.parentId : nullableIntId(data.parentId),
    name: data.name === undefined ? existing.name : String(data.name || "").trim(),
    type: data.type === undefined ? existing.type : normalizeType(data.type),
    externalCode: data.externalCode === undefined ? existing.externalCode : String(data.externalCode || "").trim(),
    status: data.status === undefined ? existing.status : normalizeStatus(data.status)
  };
  if (!payload.name) throw new Error("name is required");
  assertParent(scope, payload.parentId, id);
  assertNoCycle(scope, id, payload.parentId);
  statements.updateUnit.run(payload);
  return unitById(scope, id);
}

export function listOrgTree(scope = {}) {
  const current = requireScope(scope);
  const units = statements.listUnits.all(current);
  const assignments = statements.assignmentsForScope.all(current);
  const flat = decorateUnits(units, assignments);
  return {
    tenantId: current.tenantId,
    branchId: current.branchId,
    units: buildTree(flat),
    flat
  };
}

export function assignBranch(data = {}) {
  const current = requireScope(data);
  const orgScopeBranchId = String(data.orgScopeBranchId || current.branchId).trim();
  if (!orgScopeBranchId) throw new Error("orgScopeBranchId is required");
  const orgUnitId = intId(data.orgUnitId, "orgUnitId");
  const orgUnit = unitById({ tenantId: current.tenantId, branchId: orgScopeBranchId }, orgUnitId);
  if (!orgUnit) throw new Error("org unit not found");

  const payload = {
    tenantId: current.tenantId,
    branchId: current.branchId,
    orgUnitId,
    status: normalizeStatus(data.status),
    assignedBy: data.assignedBy || null
  };
  statements.upsertAssignment.run(payload);
  return {
    assignment: statements.getAssignment.get({ tenantId: current.tenantId, branchId: current.branchId }),
    orgUnit,
    path: getBranchOrgPath({ tenantId: current.tenantId, branchId: current.branchId })
  };
}

export function getBranchOrgPath(scope = {}) {
  const current = requireScope(scope);
  const assignment = statements.getAssignment.get(current);
  if (!assignment) return [];

  const path = [];
  const seen = new Set();
  let unit = statements.getTenantUnit.get({ tenantId: current.tenantId, id: assignment.orgUnitId });
  for (let depth = 0; unit && depth < 25; depth += 1) {
    if (seen.has(unit.id)) break;
    seen.add(unit.id);
    path.unshift(unit);
    unit = unit.parentId
      ? statements.getTenantUnit.get({ tenantId: current.tenantId, id: unit.parentId })
      : null;
  }
  return path;
}

export const orgHierarchyRepo = {
  createOrgUnit,
  updateOrgUnit,
  listOrgTree,
  assignBranch,
  getBranchOrgPath
};
