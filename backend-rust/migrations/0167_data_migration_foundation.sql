ALTER TABLE integration_import_jobs
  ADD COLUMN IF NOT EXISTS source_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'csv',
  ADD COLUMN IF NOT EXISTS source_row_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valid_row_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_row_count INTEGER NOT NULL DEFAULT 0;

UPDATE integration_import_jobs
SET source_row_count = GREATEST(source_row_count, total_rows + jsonb_array_length(errors_json)),
    valid_row_count = GREATEST(valid_row_count, total_rows),
    error_row_count = GREATEST(error_row_count, jsonb_array_length(errors_json));

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_import_jobs_active_source
  ON integration_import_jobs(tenant_id, branch_id, entity, source_hash)
  WHERE mode = 'commit'
    AND status <> 'rolled_back'
    AND source_hash IS NOT NULL
    AND source_hash <> '';

CREATE TABLE IF NOT EXISTS integration_import_batches (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES integration_import_jobs(id) ON DELETE CASCADE,
  batch_number INTEGER NOT NULL CHECK(batch_number > 0),
  status TEXT NOT NULL CHECK(status IN ('processing','completed','failed','rolled_back')),
  start_offset INTEGER NOT NULL CHECK(start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK(end_offset >= start_offset),
  processed_rows INTEGER NOT NULL DEFAULT 0 CHECK(processed_rows >= 0),
  imported_rows INTEGER NOT NULL DEFAULT 0 CHECK(imported_rows >= 0),
  error_rows INTEGER NOT NULL DEFAULT 0 CHECK(error_rows >= 0),
  last_error TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_integration_import_batches_scope
  ON integration_import_batches(tenant_id, branch_id, job_id, batch_number);

CREATE TABLE IF NOT EXISTS integration_import_row_results (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES integration_import_jobs(id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES integration_import_batches(id) ON DELETE SET NULL,
  entity TEXT NOT NULL CHECK(entity IN ('clients','staff')),
  source_sheet TEXT NOT NULL DEFAULT 'csv',
  source_row_number INTEGER NOT NULL CHECK(source_row_number > 1),
  source_external_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('validated','error','imported','rolled_back')),
  target_id TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  source_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, source_row_number)
);

CREATE INDEX IF NOT EXISTS idx_integration_import_row_results_scope
  ON integration_import_row_results(tenant_id, branch_id, job_id, status, source_row_number);
CREATE INDEX IF NOT EXISTS idx_integration_import_row_results_external
  ON integration_import_row_results(tenant_id, branch_id, entity, source_external_id)
  WHERE source_external_id IS NOT NULL AND source_external_id <> '';
CREATE INDEX IF NOT EXISTS idx_integration_import_row_results_target
  ON integration_import_row_results(tenant_id, branch_id, entity, target_id)
  WHERE target_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS integration_import_audit_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  job_id TEXT REFERENCES integration_import_jobs(id) ON DELETE SET NULL,
  batch_id TEXT REFERENCES integration_import_batches(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('success','failure')),
  actor_user_id TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_import_audit_scope
  ON integration_import_audit_events(tenant_id, branch_id, job_id, created_at DESC);
