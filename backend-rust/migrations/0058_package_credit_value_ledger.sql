ALTER TABLE client_package_credits
  ADD COLUMN IF NOT EXISTS issued_value_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE client_package_credits
  DROP CONSTRAINT IF EXISTS client_package_credits_value_check;

ALTER TABLE client_package_credits
  ADD CONSTRAINT client_package_credits_value_check CHECK (
    unit_value_paise >= 0 AND issued_value_paise >= 0
  );

ALTER TABLE pos_package_redemptions
  ADD COLUMN IF NOT EXISTS unit_value_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS redeemed_value_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_package_redemptions
  DROP CONSTRAINT IF EXISTS pos_package_redemptions_value_check;

ALTER TABLE pos_package_redemptions
  ADD CONSTRAINT pos_package_redemptions_value_check CHECK (
    unit_value_paise >= 0 AND redeemed_value_paise >= 0
  );

CREATE INDEX IF NOT EXISTS idx_pos_package_redemptions_credit_value
  ON pos_package_redemptions (tenant_id, branch_id, client_package_credit_id, created_at);
