ALTER TABLE client_package_credits
  ADD COLUMN IF NOT EXISTS original_client_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS frozen_until DATE,
  ADD COLUMN IF NOT EXISTS freeze_reason TEXT NOT NULL DEFAULT '';

UPDATE client_package_credits
SET original_client_id=client_id
WHERE original_client_id='';

ALTER TABLE gift_cards
  ADD COLUMN IF NOT EXISTS original_client_id TEXT NOT NULL DEFAULT '';

UPDATE gift_cards
SET original_client_id=client_id
WHERE original_client_id='';

ALTER TABLE pos_package_redemptions
  ADD COLUMN IF NOT EXISTS source_branch_id TEXT NOT NULL DEFAULT '';

UPDATE pos_package_redemptions
SET source_branch_id=branch_id
WHERE source_branch_id='';

ALTER TABLE pos_membership_redemptions
  ADD COLUMN IF NOT EXISTS source_branch_id TEXT NOT NULL DEFAULT '';

UPDATE pos_membership_redemptions
SET source_branch_id=branch_id
WHERE source_branch_id='';

ALTER TABLE membership_reward_ledger
  DROP CONSTRAINT IF EXISTS membership_reward_ledger_transaction_type_check;
ALTER TABLE membership_reward_ledger
  ADD CONSTRAINT membership_reward_ledger_transaction_type_check
  CHECK (transaction_type IN ('earned','redeemed','reversed','adjusted','expired'));

ALTER TABLE gift_card_transactions
  DROP CONSTRAINT IF EXISTS gift_card_transactions_transaction_type_check;
ALTER TABLE gift_card_transactions
  ADD CONSTRAINT gift_card_transactions_transaction_type_check
  CHECK (transaction_type IN ('issue','reload','redeem','refund','adjustment_credit','adjustment_debit'));

CREATE TABLE IF NOT EXISTS customer_liability_lifecycle_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  liability_type TEXT NOT NULL CHECK (liability_type IN ('package','gift_card')),
  liability_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('freeze','resume','transfer','reload')),
  source_branch_id TEXT NOT NULL DEFAULT '',
  target_branch_id TEXT NOT NULL DEFAULT '',
  source_client_id TEXT NOT NULL DEFAULT '',
  target_client_id TEXT NOT NULL DEFAULT '',
  quantity_before INTEGER NOT NULL DEFAULT 0 CHECK (quantity_before >= 0),
  quantity_after INTEGER NOT NULL DEFAULT 0 CHECK (quantity_after >= 0),
  balance_before_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_before_paise >= 0),
  balance_after_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_after_paise >= 0),
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, liability_type, liability_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_customer_liability_lifecycle_events_record
  ON customer_liability_lifecycle_events
  (tenant_id, liability_type, liability_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_customer_liability_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'customer liability lifecycle history is immutable' USING ERRCODE='P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_liability_lifecycle_events_immutable
  ON customer_liability_lifecycle_events;
CREATE TRIGGER trg_customer_liability_lifecycle_events_immutable
BEFORE UPDATE OR DELETE ON customer_liability_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION prevent_customer_liability_event_mutation();
