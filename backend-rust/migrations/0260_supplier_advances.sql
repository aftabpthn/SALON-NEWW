CREATE TABLE IF NOT EXISTS supplier_advances (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank','upi','card','other')),
  reference TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  paid_by TEXT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_supplier_advances_supplier
  ON supplier_advances (tenant_id, branch_id, supplier_id, paid_at DESC);
