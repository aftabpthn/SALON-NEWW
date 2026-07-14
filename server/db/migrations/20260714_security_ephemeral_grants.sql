CREATE TABLE IF NOT EXISTS securityEphemeralGrants (
  id TEXT PRIMARY KEY,
  proofHash TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  purpose TEXT NOT NULL,
  subjectId TEXT NOT NULL DEFAULT '',
  userId TEXT NOT NULL DEFAULT '',
  staffId TEXT NOT NULL DEFAULT '',
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL DEFAULT '',
  sessionId TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  expiresAt TEXT NOT NULL,
  consumedAt TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_securityEphemeralGrants_cleanup
  ON securityEphemeralGrants(expiresAt, consumedAt);
