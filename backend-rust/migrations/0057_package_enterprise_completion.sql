ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS paid_sessions INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS free_sessions INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_price_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS show_mobile_app BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_online_booking BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE packages
  DROP CONSTRAINT IF EXISTS packages_enterprise_values_check;

ALTER TABLE packages
  ADD CONSTRAINT packages_enterprise_values_check CHECK (
    paid_sessions > 0 AND free_sessions >= 0 AND
    cost_price_paise >= 0 AND price_paise >= 0 AND
    validity_days >= 0 AND discount_percent BETWEEN 0 AND 100
  );

CREATE TABLE IF NOT EXISTS package_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id)
);

ALTER TABLE client_package_credits
  ADD COLUMN IF NOT EXISTS unit_value_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE client_package_credits
  DROP CONSTRAINT IF EXISTS client_package_credits_unit_value_check;

ALTER TABLE client_package_credits
  ADD CONSTRAINT client_package_credits_unit_value_check
  CHECK (unit_value_paise >= 0);
