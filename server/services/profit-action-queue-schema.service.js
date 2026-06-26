import { db } from "../db.js";

let ensured = false;

export function ensureProfitActionQueueSchema() {
  if (ensured) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS profit_action_queue (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      impactPaise INTEGER NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      sourceType TEXT NOT NULL DEFAULT '',
      sourceId TEXT NOT NULL DEFAULT '',
      payloadJson TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approvedAt TEXT NOT NULL DEFAULT '',
      completedAt TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_profit_action_queue_scope
      ON profit_action_queue(tenantId, branchId, status, priority, updatedAt);
    CREATE INDEX IF NOT EXISTS idx_profit_action_queue_source
      ON profit_action_queue(tenantId, branchId, sourceType, sourceId, status);
  `);
  ensured = true;
}
