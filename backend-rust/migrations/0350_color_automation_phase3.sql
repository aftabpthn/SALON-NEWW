ALTER TABLE inventory_color_bowls
  ADD COLUMN IF NOT EXISTS service_price_paise BIGINT
  CHECK (service_price_paise IS NULL OR service_price_paise >= 0);

CREATE INDEX IF NOT EXISTS idx_inventory_color_bowls_service_date
  ON inventory_color_bowls (tenant_id, branch_id, service_id, created_at DESC);
