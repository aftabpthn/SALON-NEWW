CREATE TABLE IF NOT EXISTS cash_drawer_bank_deposits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  bank_name TEXT NOT NULL,
  reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  deposited_by_user_id TEXT NOT NULL,
  confirmed_by_user_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  deposited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_bank_deposits_session
  ON cash_drawer_bank_deposits (tenant_id, branch_id, drawer_session_id, deposited_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_bank_deposit_reference
  ON cash_drawer_bank_deposits (tenant_id, branch_id, reference);
