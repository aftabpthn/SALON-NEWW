ALTER TABLE pos_payments
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

UPDATE pos_payments
   SET paid_at = created_at
 WHERE paid_at IS NULL;

ALTER TABLE pos_payments
  ALTER COLUMN paid_at SET DEFAULT NOW(),
  ALTER COLUMN paid_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_payments_sale_paid_at
  ON pos_payments (tenant_id, branch_id, sale_id, paid_at DESC);
