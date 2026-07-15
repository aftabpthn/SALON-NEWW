CREATE TABLE IF NOT EXISTS integration_import_upload_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  file_extension TEXT NOT NULL CHECK(file_extension IN ('csv','xlsx','zip')),
  declared_content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  expected_size_bytes BIGINT NOT NULL CHECK(expected_size_bytes > 0),
  expected_sha256 TEXT NOT NULL DEFAULT '',
  total_parts INTEGER NOT NULL CHECK(total_parts BETWEEN 1 AND 1000),
  received_parts INTEGER NOT NULL DEFAULT 0 CHECK(received_parts >= 0),
  received_bytes BIGINT NOT NULL DEFAULT 0 CHECK(received_bytes >= 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','assembling','completed','failed','expired','aborted')),
  source_file_id TEXT,
  created_by TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(tenant_id, branch_id, id)
);

CREATE INDEX IF NOT EXISTS idx_import_upload_sessions_scope
  ON integration_import_upload_sessions(tenant_id, branch_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS integration_import_upload_parts (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  upload_session_id TEXT NOT NULL,
  part_number INTEGER NOT NULL CHECK(part_number > 0),
  size_bytes BIGINT NOT NULL CHECK(size_bytes > 0),
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(upload_session_id, part_number),
  FOREIGN KEY(tenant_id, branch_id, upload_session_id)
    REFERENCES integration_import_upload_sessions(tenant_id, branch_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_upload_parts_scope
  ON integration_import_upload_parts(tenant_id, branch_id, upload_session_id, part_number);

CREATE TABLE IF NOT EXISTS integration_import_source_files (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  upload_session_id TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  file_extension TEXT NOT NULL CHECK(file_extension IN ('csv','xlsx','zip')),
  declared_content_type TEXT NOT NULL,
  detected_content_type TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK(file_format IN ('csv','xlsx','zip')),
  size_bytes BIGINT NOT NULL CHECK(size_bytes > 0),
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  evidence_status TEXT NOT NULL DEFAULT 'verified'
    CHECK(evidence_status IN ('verified','quarantined')),
  read_only BOOLEAN NOT NULL DEFAULT TRUE,
  manifest_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, branch_id, id),
  UNIQUE(tenant_id, branch_id, upload_session_id),
  FOREIGN KEY(tenant_id, branch_id, upload_session_id)
    REFERENCES integration_import_upload_sessions(tenant_id, branch_id, id)
    ON DELETE RESTRICT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_import_upload_source_file'
  ) THEN
    ALTER TABLE integration_import_upload_sessions
      ADD CONSTRAINT fk_import_upload_source_file
      FOREIGN KEY(tenant_id, branch_id, source_file_id)
      REFERENCES integration_import_source_files(tenant_id, branch_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_source_files_scope
  ON integration_import_source_files(tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_source_files_sha
  ON integration_import_source_files(tenant_id, branch_id, sha256);

CREATE TABLE IF NOT EXISTS integration_import_source_artifacts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  entry_name TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK(file_format IN ('csv','xlsx')),
  detected_content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK(size_bytes > 0),
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_file_id, entry_name),
  FOREIGN KEY(tenant_id, branch_id, source_file_id)
    REFERENCES integration_import_source_files(tenant_id, branch_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_source_artifacts_scope
  ON integration_import_source_artifacts(tenant_id, branch_id, source_file_id);

CREATE OR REPLACE FUNCTION reject_integration_source_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'migration source evidence is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_import_source_evidence_immutable ON integration_import_source_files;
CREATE TRIGGER trg_import_source_evidence_immutable
BEFORE UPDATE OR DELETE ON integration_import_source_files
FOR EACH ROW EXECUTE FUNCTION reject_integration_source_evidence_mutation();
