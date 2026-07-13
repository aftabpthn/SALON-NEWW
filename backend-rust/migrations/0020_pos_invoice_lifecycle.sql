CREATE TABLE IF NOT EXISTS pos_invoice_voids (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_invoice_voids_one
  ON pos_invoice_voids (tenant_id, branch_id, sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_invoice_voids_idempotency
  ON pos_invoice_voids (tenant_id, branch_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE TABLE IF NOT EXISTS pos_invoice_refunds (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_refunds_sale
  ON pos_invoice_refunds (tenant_id, branch_id, sale_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_invoice_refunds_idempotency
  ON pos_invoice_refunds (tenant_id, branch_id, sale_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE TABLE IF NOT EXISTS pos_credit_notes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  credit_note_number TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, credit_note_number)
);

CREATE INDEX IF NOT EXISTS idx_pos_credit_notes_sale
  ON pos_credit_notes (tenant_id, branch_id, sale_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_credit_notes_idempotency
  ON pos_credit_notes (tenant_id, branch_id, sale_id, idempotency_key)
  WHERE idempotency_key <> '';
