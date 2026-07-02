import { db } from "../db.js";

let ensured = false;

export function ensureCustomerCareAiSchema() {
  if (ensured) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS customerCareAiSessions (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      customerId TEXT DEFAULT '',
      customerName TEXT DEFAULT '',
      customerPhone TEXT DEFAULT '',
      topic TEXT DEFAULT 'General support',
      status TEXT DEFAULT 'open',
      lastSummary TEXT DEFAULT '',
      messagesJson TEXT DEFAULT '[]',
      metadataJson TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_customerCareAiSessions_scope ON customerCareAiSessions(tenantId, branchId, updatedAt)`,
    `CREATE INDEX IF NOT EXISTS idx_customerCareAiSessions_customer ON customerCareAiSessions(tenantId, branchId, customerPhone, customerId)`,
    `CREATE TABLE IF NOT EXISTS customerCareAiTickets (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      sessionId TEXT DEFAULT '',
      customerId TEXT DEFAULT '',
      customerName TEXT DEFAULT '',
      customerPhone TEXT DEFAULT '',
      topic TEXT DEFAULT 'General support',
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      assignedRole TEXT DEFAULT 'manager',
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      escalationReason TEXT DEFAULT '',
      relatedModulesJson TEXT DEFAULT '[]',
      auditJson TEXT DEFAULT '[]',
      createdByRole TEXT DEFAULT '',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_customerCareAiTickets_scope ON customerCareAiTickets(tenantId, branchId, status, updatedAt)`,
    `CREATE INDEX IF NOT EXISTS idx_customerCareAiTickets_customer ON customerCareAiTickets(tenantId, branchId, customerPhone, customerId)`
  ];
  const run = db.transaction(() => {
    for (const sql of statements) db.prepare(sql).run();
  });
  run();
  ensured = true;
}

ensureCustomerCareAiSchema();
