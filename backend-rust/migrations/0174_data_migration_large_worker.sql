-- Version 0174 avoids the existing 0171 Balance Sheet migration.
ALTER TABLE integration_import_jobs
  DROP CONSTRAINT IF EXISTS integration_import_jobs_status_check;
ALTER TABLE integration_import_jobs
  ADD CONSTRAINT integration_import_jobs_status_check
  CHECK(status IN ('staging','validated','queued','processing','paused','completed','failed','cancelled','rolled_back'));

ALTER TABLE integration_import_jobs
  ADD COLUMN IF NOT EXISTS source_file_id TEXT,
  ADD COLUMN IF NOT EXISTS chunk_size INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS allow_partial_import BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS duplicate_decisions_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS worker_phase TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS worker_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_chunks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_chunks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_chunks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE integration_import_jobs
  DROP CONSTRAINT IF EXISTS integration_import_jobs_chunk_size_check;
ALTER TABLE integration_import_jobs
  ADD CONSTRAINT integration_import_jobs_chunk_size_check CHECK(chunk_size BETWEEN 100 AND 10000);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_import_job_source_file') THEN
    ALTER TABLE integration_import_jobs
      ADD CONSTRAINT fk_import_job_source_file
      FOREIGN KEY(tenant_id, branch_id, source_file_id)
      REFERENCES integration_import_source_files(tenant_id, branch_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DROP INDEX IF EXISTS uq_integration_import_jobs_active_source;
CREATE UNIQUE INDEX uq_integration_import_jobs_active_source
  ON integration_import_jobs(tenant_id, branch_id, entity, source_hash)
  WHERE mode = 'commit'
    AND source_hash IS NOT NULL
    AND source_hash <> ''
    AND status NOT IN ('cancelled','rolled_back');

CREATE INDEX IF NOT EXISTS idx_integration_import_jobs_large_due
  ON integration_import_jobs(status, worker_phase, lease_expires_at, created_at)
  WHERE source_file_id IS NOT NULL AND status IN ('staging','queued','processing');

CREATE TABLE IF NOT EXISTS integration_import_chunks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES integration_import_jobs(id) ON DELETE CASCADE,
  chunk_number INTEGER NOT NULL CHECK(chunk_number > 0),
  source_sheet TEXT NOT NULL,
  source_row_start INTEGER NOT NULL CHECK(source_row_start > 1),
  source_row_end INTEGER NOT NULL CHECK(source_row_end >= source_row_start),
  total_rows INTEGER NOT NULL CHECK(total_rows > 0),
  ready_rows INTEGER NOT NULL DEFAULT 0 CHECK(ready_rows >= 0),
  error_rows INTEGER NOT NULL DEFAULT 0 CHECK(error_rows >= 0),
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK(status IN ('staged','pending','processing','completed','failed','cancelled')),
  checksum TEXT NOT NULL,
  processed_rows INTEGER NOT NULL DEFAULT 0 CHECK(processed_rows >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  worker_id TEXT NOT NULL DEFAULT '',
  heartbeat_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, chunk_number),
  UNIQUE(tenant_id, branch_id, id)
);

CREATE INDEX IF NOT EXISTS idx_integration_import_chunks_claim
  ON integration_import_chunks(status, lease_expires_at, job_id, chunk_number)
  WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_integration_import_chunks_scope
  ON integration_import_chunks(tenant_id, branch_id, job_id, chunk_number);

CREATE TABLE IF NOT EXISTS integration_import_staging_rows (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES integration_import_jobs(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row_number INTEGER NOT NULL CHECK(source_row_number > 1),
  source_external_id TEXT,
  status TEXT NOT NULL,
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  warnings_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, source_sheet, source_row_number),
  FOREIGN KEY(tenant_id, branch_id, chunk_id)
    REFERENCES integration_import_chunks(tenant_id, branch_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_integration_import_staging_rows_chunk
  ON integration_import_staging_rows(tenant_id, branch_id, job_id, chunk_id, source_row_number);
CREATE INDEX IF NOT EXISTS idx_integration_import_staging_rows_ready
  ON integration_import_staging_rows(job_id, chunk_id, source_row_number) WHERE ready;

ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_job_id_source_row_number_key;
ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_job_sheet_row_key;
ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_job_sheet_row_key
  UNIQUE(job_id, source_sheet, source_row_number);
