CREATE TABLE IF NOT EXISTS staff_mobile_crash_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('web','android','ios')),
  app_version TEXT NOT NULL,
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  source_path TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,branch_id,staff_id,fingerprint,occurred_at)
);

CREATE INDEX IF NOT EXISTS idx_staff_mobile_crash_scope
  ON staff_mobile_crash_reports(tenant_id,branch_id,staff_id,created_at DESC);
