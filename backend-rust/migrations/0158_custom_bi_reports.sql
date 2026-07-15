CREATE TABLE IF NOT EXISTS custom_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 120),
  definition_json JSONB NOT NULL,
  schedule_frequency TEXT NOT NULL DEFAULT 'none'
    CHECK (schedule_frequency IN ('none', 'daily', 'weekly', 'monthly')),
  schedule_day SMALLINT NOT NULL DEFAULT 1 CHECK (schedule_day BETWEEN 1 AND 28),
  schedule_time TIME NOT NULL DEFAULT '09:00',
  recipient_email TEXT NOT NULL DEFAULT '',
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'never'
    CHECK (last_status IN ('never', 'processing', 'completed', 'failed')),
  last_error TEXT NOT NULL DEFAULT '',
  last_result_json JSONB,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_reports_scope
  ON custom_reports (tenant_id, branch_id, active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_reports_due
  ON custom_reports (next_run_at)
  WHERE active = TRUE AND schedule_frequency <> 'none' AND next_run_at IS NOT NULL;
