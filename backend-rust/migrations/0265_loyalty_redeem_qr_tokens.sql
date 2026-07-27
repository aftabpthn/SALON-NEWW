CREATE TABLE IF NOT EXISTS loyalty_redeem_qr_tokens (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  token TEXT NOT NULL UNIQUE,
  points INTEGER NOT NULL CHECK (points > 0),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','redeemed','expired','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_sale_id TEXT NOT NULL DEFAULT '',
  redeemed_by_user_id TEXT NOT NULL DEFAULT '',
  redeemed_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_redeem_qr_idempotency
  ON loyalty_redeem_qr_tokens (tenant_id, branch_id, client_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_loyalty_redeem_qr_scope
  ON loyalty_redeem_qr_tokens (tenant_id, branch_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_redeem_qr_status
  ON loyalty_redeem_qr_tokens (tenant_id, branch_id, status, expires_at);
