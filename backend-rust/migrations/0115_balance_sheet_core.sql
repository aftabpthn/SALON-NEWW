ALTER TABLE accounting_journal_entries
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;

CREATE TABLE IF NOT EXISTS balance_sheet_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  as_of_date DATE NOT NULL,
  total_assets_paise BIGINT NOT NULL,
  total_liabilities_paise BIGINT NOT NULL,
  total_equity_paise BIGINT NOT NULL,
  accounting_equation_difference_paise BIGINT NOT NULL,
  balanced BOOLEAN NOT NULL,
  payload JSONB NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_balance_sheet_snapshots_scope
  ON balance_sheet_snapshots (tenant_id, branch_id, as_of_date DESC, created_at DESC);
