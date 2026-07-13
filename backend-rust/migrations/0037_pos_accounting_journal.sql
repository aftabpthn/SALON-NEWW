CREATE TABLE IF NOT EXISTS accounting_journal_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS accounting_journal_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  journal_entry_id TEXT NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL,
  debit_paise BIGINT NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise BIGINT NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  CHECK ((debit_paise = 0) <> (credit_paise = 0))
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_entries_source
  ON accounting_journal_entries (tenant_id, branch_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_entry
  ON accounting_journal_lines (journal_entry_id, account_code);
