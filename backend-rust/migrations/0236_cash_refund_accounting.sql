CREATE TABLE IF NOT EXISTS pos_refund_payment_allocations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  refund_id TEXT NOT NULL REFERENCES pos_invoice_refunds(id) ON DELETE RESTRICT,
  pos_payment_id TEXT NOT NULL REFERENCES pos_payments(id) ON DELETE RESTRICT,
  method TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, refund_id, pos_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_refund_payment_allocations_payment
  ON pos_refund_payment_allocations (tenant_id, branch_id, pos_payment_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_invoice_refund_movement
  ON cash_drawer_movements (tenant_id, branch_id, reference_type, reference_id)
  WHERE movement_type = 'refund_cash' AND reference_type = 'invoice_refund';
