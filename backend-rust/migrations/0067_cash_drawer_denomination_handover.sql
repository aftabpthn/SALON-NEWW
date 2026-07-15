ALTER TABLE cash_drawer_sessions
  ADD COLUMN IF NOT EXISTS denomination_breakdown_json JSONB NOT NULL DEFAULT '{"denominations":[],"looseCashPaise":0}'::jsonb,
  ADD COLUMN IF NOT EXISTS handover_to_staff_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS handover_by_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS handover_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS handover_at TIMESTAMPTZ;
