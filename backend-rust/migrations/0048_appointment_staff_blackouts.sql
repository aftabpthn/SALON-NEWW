ALTER TABLE appointment_blackouts
  ADD COLUMN IF NOT EXISTS staff_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS blocked_from TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_appointment_blackouts_staff_time
  ON appointment_blackouts(tenant_id, branch_id, staff_id, blocked_from, blocked_until);
