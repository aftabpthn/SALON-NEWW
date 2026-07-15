ALTER TABLE clients ADD COLUMN IF NOT EXISTS import_job_id TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS import_job_id TEXT;
CREATE INDEX IF NOT EXISTS idx_clients_import_job ON clients(tenant_id,branch_id,import_job_id) WHERE import_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_import_job ON staff(tenant_id,branch_id,import_job_id) WHERE import_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS integration_import_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK(entity IN ('clients','staff')),
  file_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('dry-run','commit')),
  status TEXT NOT NULL CHECK(status IN ('validated','queued','processing','completed','failed','rolled_back')),
  rows_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  errors_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  next_row INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_integration_import_jobs_scope ON integration_import_jobs(tenant_id,branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_import_jobs_due ON integration_import_jobs(status,created_at) WHERE status='queued';
