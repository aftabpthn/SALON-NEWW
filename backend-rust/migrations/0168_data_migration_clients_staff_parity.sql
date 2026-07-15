CREATE TABLE IF NOT EXISTS integration_import_mappings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK(entity IN ('clients','staff')),
  name TEXT NOT NULL,
  mapping_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  source_columns_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_import_mappings_name
  ON integration_import_mappings(tenant_id, branch_id, entity, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_integration_import_mappings_scope
  ON integration_import_mappings(tenant_id, branch_id, entity, updated_at DESC);

ALTER TABLE integration_import_jobs
  ADD COLUMN IF NOT EXISTS mapping_id TEXT REFERENCES integration_import_mappings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mapping_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS analysis_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS recovery_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS warning_row_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_row_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_status_check;
ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_status_check
  CHECK(status IN ('validated','warning','duplicate','error','imported','created','merged','linked','kept','rolled_back'));

ALTER TABLE integration_import_row_results
  ADD COLUMN IF NOT EXISTS warnings_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS duplicate_target_id TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_decision TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS before_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS recovery_action TEXT NOT NULL DEFAULT '';

ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_duplicate_decision_check;
ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_duplicate_decision_check
  CHECK(duplicate_decision IN ('','merge','keep','link'));

ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_action_check;
ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_action_check
  CHECK(action IN ('','created','merged','linked','kept'));

CREATE INDEX IF NOT EXISTS idx_integration_import_row_results_duplicate
  ON integration_import_row_results(tenant_id, branch_id, job_id, duplicate_decision, source_row_number)
  WHERE duplicate_target_id IS NOT NULL;

DROP INDEX IF EXISTS uq_integration_import_jobs_active_source;
CREATE UNIQUE INDEX uq_integration_import_jobs_active_source
  ON integration_import_jobs(tenant_id, branch_id, entity, source_hash)
  WHERE mode = 'commit'
    AND source_hash IS NOT NULL
    AND source_hash <> ''
    AND (
      status IN ('queued','processing','completed')
      OR (status = 'failed' AND errors_json = '[]'::JSONB)
    );
