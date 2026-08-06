CREATE TABLE IF NOT EXISTS customerInboxNotifications (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL DEFAULT '',
  customerId TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'transactional',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  deepLink TEXT NOT NULL DEFAULT '',
  sourceType TEXT NOT NULL DEFAULT '',
  sourceId TEXT NOT NULL DEFAULT '',
  eventKey TEXT NOT NULL,
  pushNotificationId TEXT NOT NULL DEFAULT '',
  scheduledAt TEXT NOT NULL,
  readAt TEXT NOT NULL DEFAULT '',
  archivedAt TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(tenantId) REFERENCES tenants(id),
  UNIQUE(tenantId, customerId, eventKey)
);

CREATE INDEX IF NOT EXISTS idx_customerInboxNotifications_customer
  ON customerInboxNotifications(tenantId, customerId, scheduledAt DESC, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_customerInboxNotifications_unread
  ON customerInboxNotifications(tenantId, customerId, readAt, archivedAt, scheduledAt);

CREATE TABLE IF NOT EXISTS customerNotificationPreferences (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL DEFAULT '',
  customerId TEXT NOT NULL,
  bookingReminders INTEGER NOT NULL DEFAULT 1,
  promotions INTEGER NOT NULL DEFAULT 1,
  loyalty INTEGER NOT NULL DEFAULT 1,
  membership INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(tenantId) REFERENCES tenants(id),
  UNIQUE(tenantId, customerId)
);

CREATE INDEX IF NOT EXISTS idx_customerNotificationPreferences_customer
  ON customerNotificationPreferences(tenantId, customerId);
