CREATE TABLE IF NOT EXISTS integration_import_job_dependencies (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES integration_import_jobs(id) ON DELETE CASCADE,
  depends_on_job_id TEXT NOT NULL REFERENCES integration_import_jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, depends_on_job_id),
  CHECK (job_id <> depends_on_job_id)
);

CREATE INDEX IF NOT EXISTS idx_import_job_dependencies_scope
  ON integration_import_job_dependencies(tenant_id, branch_id, job_id);

CREATE INDEX IF NOT EXISTS idx_import_job_dependencies_prerequisite
  ON integration_import_job_dependencies(tenant_id, branch_id, depends_on_job_id);
