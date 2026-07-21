CREATE TABLE IF NOT EXISTS multi_branch_settlements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  redemption_branch_id TEXT NOT NULL,
  redemption_id TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL DEFAULT 'settled' CHECK (status = 'settled'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank_transfer')),
  settlement_reference TEXT NOT NULL,
  source_accrual_journal_id TEXT NOT NULL,
  target_accrual_journal_id TEXT NOT NULL,
  source_payment_journal_id TEXT NOT NULL,
  target_payment_journal_id TEXT NOT NULL,
  settled_by_user_id TEXT NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, redemption_id)
);

CREATE INDEX IF NOT EXISTS idx_multi_branch_settlements_scope
  ON multi_branch_settlements (tenant_id, branch_id, redemption_branch_id, settled_at DESC);
