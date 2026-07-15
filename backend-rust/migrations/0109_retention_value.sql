ALTER TABLE gift_cards
  ADD COLUMN IF NOT EXISTS reissued_from_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voided_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gift_cards_reissued_from
  ON gift_cards (tenant_id, branch_id, reissued_from_id)
  WHERE reissued_from_id <> '';

CREATE TABLE IF NOT EXISTS client_referral_codes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, client_id),
  UNIQUE (tenant_id, branch_id, code)
);

CREATE TABLE IF NOT EXISTS client_referrals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  referrer_client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  referred_client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  referral_code_id TEXT NOT NULL REFERENCES client_referral_codes(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  completed_by TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (referrer_client_id <> referred_client_id),
  UNIQUE (tenant_id, branch_id, referred_client_id),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_client_referrals_referrer
  ON client_referrals (tenant_id, branch_id, referrer_client_id, created_at DESC);
