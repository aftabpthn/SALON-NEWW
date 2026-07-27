-- Customer-Salon relationship tracking for primary salon concept.
-- Each customer can visit many salons, but only one is "primary".
-- All loyalty/wallet/membership data remains scoped to tenantId.

CREATE TABLE IF NOT EXISTS customerSalonRelationships (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL DEFAULT '',
  businessId TEXT NOT NULL DEFAULT '',
  businessName TEXT NOT NULL DEFAULT '',
  relationshipType TEXT NOT NULL DEFAULT 'guest',
  visitCount INTEGER NOT NULL DEFAULT 0,
  lastVisitAt TEXT DEFAULT '',
  isFavorite INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(customerId, tenantId, branchId)
);

CREATE INDEX IF NOT EXISTS idx_csr_customer ON customerSalonRelationships(customerId, createdAt);
CREATE INDEX IF NOT EXISTS idx_csr_tenant ON customerSalonRelationships(tenantId, customerId);
CREATE INDEX IF NOT EXISTS idx_csr_visits ON customerSalonRelationships(customerId, visitCount DESC);

CREATE TABLE IF NOT EXISTS customerPrimarySalons (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL UNIQUE,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  businessId TEXT NOT NULL DEFAULT '',
  businessName TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'manual',
  setAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cps_customer ON customerPrimarySalons(customerId);
