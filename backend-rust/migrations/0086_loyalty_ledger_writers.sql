ALTER TABLE membership_reward_ledger
  ADD COLUMN IF NOT EXISTS source_refund_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_membership_reward_ledger_sale_type;
CREATE UNIQUE INDEX idx_membership_reward_ledger_sale_type
  ON membership_reward_ledger (tenant_id, branch_id, source_sale_id, transaction_type)
  WHERE source_sale_id <> '' AND transaction_type IN ('earned', 'redeemed');

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_reward_ledger_refund
  ON membership_reward_ledger (tenant_id, branch_id, source_refund_id)
  WHERE source_refund_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_reward_ledger_idempotency
  ON membership_reward_ledger (tenant_id, branch_id, idempotency_key)
  WHERE idempotency_key <> '';
