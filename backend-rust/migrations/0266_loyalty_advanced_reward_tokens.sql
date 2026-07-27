ALTER TABLE loyalty_redeem_qr_tokens
  ADD COLUMN IF NOT EXISTS reward_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reward_type TEXT NOT NULL DEFAULT 'flat_discount',
  ADD COLUMN IF NOT EXISTS reward_label TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reward_value_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_bps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS occasion_type TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_loyalty_redeem_qr_reward_type'
  ) THEN
    ALTER TABLE loyalty_redeem_qr_tokens
      ADD CONSTRAINT chk_loyalty_redeem_qr_reward_type
      CHECK (reward_type IN ('flat_discount','percentage_discount','free_service','wallet_credit','birthday_reward','anniversary_reward')) NOT VALID;
  END IF;
END $$;
