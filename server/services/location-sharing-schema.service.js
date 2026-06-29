import { db } from "../db.js";
import { logger } from "../utils/logger.js";

let ensured = false;

export function ensureLocationSharingSchema() {
  if (ensured) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS locationSharingSettings (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      module TEXT NOT NULL,
      enabled INTEGER DEFAULT 0,
      modes TEXT DEFAULT '{}',
      overridePolicy TEXT DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locationSharingRules (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      sourceBranchId TEXT NOT NULL,
      targetBranchId TEXT NOT NULL,
      module TEXT NOT NULL,
      modes TEXT DEFAULT '{}',
      overridePolicy TEXT DEFAULT '{}',
      approvalStatus TEXT DEFAULT 'not_required',
      status TEXT DEFAULT 'active',
      createdBy TEXT DEFAULT '',
      approvedBy TEXT DEFAULT '',
      approvedAt TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locationSharingEvents (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      actorUserId TEXT DEFAULT '',
      action TEXT NOT NULL,
      module TEXT DEFAULT '',
      sourceBranchId TEXT DEFAULT '',
      targetBranchId TEXT DEFAULT '',
      entityType TEXT DEFAULT '',
      entityId TEXT DEFAULT '',
      beforePayload TEXT DEFAULT '{}',
      afterPayload TEXT DEFAULT '{}',
      status TEXT DEFAULT 'recorded',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locationSharingConflicts (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      conflictKey TEXT NOT NULL,
      conflictType TEXT NOT NULL,
      module TEXT NOT NULL,
      sourceBranchId TEXT DEFAULT '',
      targetBranchId TEXT DEFAULT '',
      summary TEXT NOT NULL,
      evidence TEXT DEFAULT '{}',
      resolution TEXT DEFAULT '{}',
      approvalStatus TEXT DEFAULT 'not_required',
      status TEXT DEFAULT 'open',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locationSharingApprovals (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      requestType TEXT NOT NULL,
      module TEXT DEFAULT '',
      sourceBranchId TEXT DEFAULT '',
      targetBranchId TEXT DEFAULT '',
      relatedType TEXT DEFAULT '',
      relatedId TEXT DEFAULT '',
      requestedBy TEXT DEFAULT '',
      decidedBy TEXT DEFAULT '',
      decisionNote TEXT DEFAULT '',
      payload TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending',
      requestedAt TEXT NOT NULL,
      decidedAt TEXT DEFAULT ''
    );
  `);

  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_location_sharing_settings_module ON locationSharingSettings(tenantId, branchId, module)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_location_sharing_rules_scope ON locationSharingRules(tenantId, sourceBranchId, targetBranchId, module)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_location_sharing_events_scope ON locationSharingEvents(tenantId, branchId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_location_sharing_conflicts_scope ON locationSharingConflicts(tenantId, status, module, createdAt)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_location_sharing_conflict_key ON locationSharingConflicts(tenantId, conflictKey)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_location_sharing_approvals_scope ON locationSharingApprovals(tenantId, status, requestedAt)").run();

  ensured = true;
  logger.info("location_sharing_schema_ensured", {
    tables: [
      "locationSharingSettings",
      "locationSharingRules",
      "locationSharingEvents",
      "locationSharingConflicts",
      "locationSharingApprovals"
    ]
  });
}
