import { db } from "../db.js";

export function ensureMessageTemplateStudioSchema() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      audience TEXT NOT NULL,
      eventKey TEXT NOT NULL,
      channel TEXT NOT NULL,
      templateKey TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `).run();
  db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_preferences_scope
    ON notification_preferences(tenantId, branchId, audience, eventKey, channel)
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_notification_preferences_template
    ON notification_preferences(tenantId, branchId, templateKey)
  `).run();
}
