ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS bill_discount_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS tip_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS round_off_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_payments
  ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_payments
  ADD COLUMN IF NOT EXISTS external_reference TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pos_payments_method
  ON pos_payments (tenant_id, branch_id, method, created_at DESC);
