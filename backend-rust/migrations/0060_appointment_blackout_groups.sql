ALTER TABLE appointment_blackouts
  ADD COLUMN IF NOT EXISTS blackout_group_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_appointment_blackouts_group
  ON appointment_blackouts(tenant_id, branch_id, blackout_group_id);
