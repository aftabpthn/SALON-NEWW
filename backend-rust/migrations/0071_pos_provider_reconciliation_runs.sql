CREATE TABLE IF NOT EXISTS pos_provider_reconciliation_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  settlement_date DATE NOT NULL,
  statement_reference TEXT NOT NULL,
  system_gross_paise BIGINT NOT NULL,
  statement_gross_paise BIGINT NOT NULL,
  fee_paise BIGINT NOT NULL DEFAULT 0,
  bank_net_paise BIGINT NOT NULL,
  gross_difference_paise BIGINT NOT NULL,
  net_difference_paise BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('matched', 'review_required', 'reviewed')),
  notes TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL,
  reviewed_by_user_id TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_provider_reconciliation_reference
  ON pos_provider_reconciliation_runs (tenant_id, branch_id, provider, statement_reference);
CREATE INDEX IF NOT EXISTS idx_pos_provider_reconciliation_date
  ON pos_provider_reconciliation_runs (tenant_id, branch_id, settlement_date DESC, created_at DESC);
