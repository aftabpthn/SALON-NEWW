CREATE TABLE IF NOT EXISTS pos_discount_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('profit_guard', 'happy_hours')),
  name TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  max_discount_bps BIGINT NOT NULL DEFAULT 0 CHECK (max_discount_bps >= 0),
  max_discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (max_discount_paise >= 0),
  min_payable_paise BIGINT NOT NULL DEFAULT 0 CHECK (min_payable_paise >= 0),
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_discount_rules_active
  ON pos_discount_rules (tenant_id, branch_id, active, rule_type, priority);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_discount_type_contract') THEN
    ALTER TABLE pos_sale_lines
      ADD CONSTRAINT pos_sale_lines_discount_type_contract
      CHECK (discount_type IN ('amount', 'percent')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_discount_value_range') THEN
    ALTER TABLE pos_sale_lines
      ADD CONSTRAINT pos_sale_lines_discount_value_range
      CHECK (discount_value_paise >= 0 AND discount_bps >= 0 AND discount_bps <= 10000) NOT VALID;
  END IF;
END $$;
