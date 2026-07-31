ALTER TABLE integration_import_staging_rows
  ADD COLUMN IF NOT EXISTS source_key TEXT;

CREATE INDEX IF NOT EXISTS idx_import_staging_source_external_identity
  ON integration_import_staging_rows(
    tenant_id,
    branch_id,
    job_id,
    source_sheet,
    LOWER(BTRIM(source_external_id))
  )
  WHERE source_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_staging_source_key
  ON integration_import_staging_rows(
    tenant_id,
    branch_id,
    job_id,
    source_sheet,
    source_key
  )
  WHERE source_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_import_jobs_scope_id
  ON integration_import_jobs(tenant_id, branch_id, id);

CREATE TABLE IF NOT EXISTS integration_import_projection_state (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  projection_key TEXT NOT NULL,
  balance BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(job_id, projection_key),
  FOREIGN KEY(tenant_id, branch_id, job_id)
    REFERENCES integration_import_jobs(tenant_id, branch_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_projection_state_scope
  ON integration_import_projection_state(tenant_id, branch_id, job_id, projection_key);
