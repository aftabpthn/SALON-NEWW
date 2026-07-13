CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('recharge', 'use', 'refund', 'adjustment_credit', 'adjustment_debit')),
  delta_paise BIGINT NOT NULL CHECK (delta_paise <> 0),
  balance_after_paise BIGINT NOT NULL CHECK (balance_after_paise >= 0),
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_client_created
  ON wallet_transactions (tenant_id, branch_id, client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency
  ON wallet_transactions (tenant_id, branch_id, client_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE TABLE IF NOT EXISTS store_credits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  initial_amount_paise BIGINT NOT NULL CHECK (initial_amount_paise > 0),
  balance_paise BIGINT NOT NULL CHECK (balance_paise >= 0),
  expires_at DATE,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired', 'voided')),
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_store_credits_client_status
  ON store_credits (tenant_id, branch_id, client_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_credits_idempotency
  ON store_credits (tenant_id, branch_id, client_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE TABLE IF NOT EXISTS store_credit_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  store_credit_id TEXT NOT NULL REFERENCES store_credits(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('issue', 'redeem', 'adjustment_credit', 'adjustment_debit')),
  delta_paise BIGINT NOT NULL CHECK (delta_paise <> 0),
  balance_after_paise BIGINT NOT NULL CHECK (balance_after_paise >= 0),
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_credit_transactions_credit_created
  ON store_credit_transactions (tenant_id, branch_id, store_credit_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_credit_transactions_idempotency
  ON store_credit_transactions (tenant_id, branch_id, store_credit_id, idempotency_key)
  WHERE idempotency_key <> '';

ALTER TABLE pos_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payments_idempotency
  ON pos_payments (tenant_id, branch_id, sale_id, idempotency_key)
  WHERE idempotency_key <> '';
