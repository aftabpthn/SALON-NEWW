CREATE TABLE IF NOT EXISTS appointment_payment_allocations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payment_link_id TEXT NOT NULL REFERENCES appointment_payment_links(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, payment_link_id, sale_id)
);

CREATE INDEX IF NOT EXISTS idx_appointment_payment_allocations_link
  ON appointment_payment_allocations (tenant_id, branch_id, payment_link_id, created_at);

CREATE INDEX IF NOT EXISTS idx_appointment_payment_allocations_sale
  ON appointment_payment_allocations (tenant_id, branch_id, sale_id, created_at);