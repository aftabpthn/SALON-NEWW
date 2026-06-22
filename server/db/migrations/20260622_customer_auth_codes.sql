CREATE TABLE IF NOT EXISTS customer_auth_codes (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL DEFAULT '',
  targetType TEXT NOT NULL,
  target TEXT NOT NULL,
  purpose TEXT NOT NULL,
  codeHash TEXT NOT NULL,
  requestedChannel TEXT DEFAULT '',
  deliveryChannel TEXT DEFAULT '',
  attemptCount INTEGER DEFAULT 0,
  maxAttempts INTEGER DEFAULT 5,
  expiresAt TEXT NOT NULL,
  consumedAt TEXT DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(tenantId) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_auth_codes_lookup
  ON customer_auth_codes(tenantId, targetType, target, purpose, consumedAt, expiresAt);

CREATE INDEX IF NOT EXISTS idx_customer_auth_codes_branch
  ON customer_auth_codes(tenantId, branchId, createdAt);
