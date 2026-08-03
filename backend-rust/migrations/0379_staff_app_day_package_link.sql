ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS day_package_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_appointments_day_package
  ON appointments(tenant_id,branch_id,day_package_id,start_at)
  WHERE day_package_id<>'';
