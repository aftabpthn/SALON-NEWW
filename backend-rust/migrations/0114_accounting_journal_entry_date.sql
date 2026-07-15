-- Accounting reports use entry_date as the tenant/branch journal business date in IST.
ALTER TABLE accounting_journal_entries
  ADD COLUMN IF NOT EXISTS entry_date DATE;

UPDATE accounting_journal_entries
SET entry_date = (created_at AT TIME ZONE 'Asia/Kolkata')::DATE
WHERE entry_date IS NULL;

ALTER TABLE accounting_journal_entries
  ALTER COLUMN entry_date SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE),
  ALTER COLUMN entry_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_journal_entries_period
  ON accounting_journal_entries (tenant_id, branch_id, entry_date DESC, created_at DESC);
