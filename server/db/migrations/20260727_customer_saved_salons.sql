CREATE TABLE IF NOT EXISTS customerSavedSalons (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL DEFAULT '',
  customerId TEXT NOT NULL,
  businessId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(tenantId, customerId, businessId)
);

CREATE INDEX IF NOT EXISTS idx_customerSavedSalons_customer
  ON customerSavedSalons(tenantId, customerId, createdAt);
