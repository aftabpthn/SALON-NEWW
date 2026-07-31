ALTER TABLE integration_import_mappings
  ADD COLUMN IF NOT EXISTS source_provider TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS source_sheet TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS normalized_headers_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS header_fingerprint TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS column_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS transformer_versions_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS approved_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

UPDATE integration_import_mappings
SET approved_by = CASE WHEN approved_by = '' THEN created_by ELSE approved_by END,
    approved_at = COALESCE(approved_at, updated_at),
    column_count = CASE
      WHEN column_count = 0 AND jsonb_typeof(source_columns_json) = 'array'
      THEN jsonb_array_length(source_columns_json)
      ELSE column_count
    END,
    normalized_headers_json = CASE
      WHEN normalized_headers_json = '[]'::JSONB THEN source_columns_json
      ELSE normalized_headers_json
    END;

ALTER TABLE integration_import_mappings
  DROP CONSTRAINT IF EXISTS integration_import_mappings_source_provider_check,
  DROP CONSTRAINT IF EXISTS integration_import_mappings_header_fingerprint_check,
  DROP CONSTRAINT IF EXISTS integration_import_mappings_column_count_check,
  DROP CONSTRAINT IF EXISTS integration_import_mappings_current_version_check;

ALTER TABLE integration_import_mappings
  ADD CONSTRAINT integration_import_mappings_source_provider_check CHECK(source_provider IN (
    'auto','zenoti','dingg','salonist','fresha','tally','busy','marg','excel','csv','manual'
  )),
  ADD CONSTRAINT integration_import_mappings_header_fingerprint_check
    CHECK(header_fingerprint = '' OR header_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT integration_import_mappings_column_count_check CHECK(column_count BETWEEN 0 AND 500),
  ADD CONSTRAINT integration_import_mappings_current_version_check CHECK(current_version > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_import_mappings_scope_id
  ON integration_import_mappings(id, tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_integration_import_mapping_profile_match
  ON integration_import_mappings(
    tenant_id, branch_id, source_provider, entity, source_sheet, header_fingerprint, updated_at DESC
  );

CREATE TABLE IF NOT EXISTS integration_import_mapping_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  mapping_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  entity TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  source_sheet TEXT NOT NULL DEFAULT '',
  source_columns_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  normalized_headers_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  header_fingerprint TEXT NOT NULL CHECK(header_fingerprint = '' OR header_fingerprint ~ '^[0-9a-f]{64}$'),
  column_count INTEGER NOT NULL CHECK(column_count BETWEEN 0 AND 500),
  mapping_json JSONB NOT NULL,
  transformer_versions_json JSONB NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  change_kind TEXT NOT NULL DEFAULT 'approved' CHECK(change_kind IN ('approved','rollback')),
  rolled_back_from_version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mapping_id, version),
  FOREIGN KEY(mapping_id, tenant_id, branch_id)
    REFERENCES integration_import_mappings(id, tenant_id, branch_id) ON DELETE CASCADE
);

INSERT INTO integration_import_mapping_versions(
  tenant_id,branch_id,mapping_id,version,entity,source_provider,source_sheet,
  source_columns_json,normalized_headers_json,header_fingerprint,column_count,
  mapping_json,transformer_versions_json,approved_by,approved_at
)
SELECT tenant_id,branch_id,id,current_version,entity,source_provider,source_sheet,
       source_columns_json,normalized_headers_json,header_fingerprint,column_count,
       mapping_json,transformer_versions_json,approved_by,COALESCE(approved_at,updated_at)
FROM integration_import_mappings
ON CONFLICT(mapping_id,version) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_integration_import_mapping_versions_scope
  ON integration_import_mapping_versions(tenant_id, branch_id, mapping_id, version DESC);

ALTER TABLE integration_import_jobs
  ADD COLUMN IF NOT EXISTS mapping_version INTEGER,
  ADD COLUMN IF NOT EXISTS mapping_header_fingerprint TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transformer_versions_json JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE integration_import_jobs
  DROP CONSTRAINT IF EXISTS integration_import_jobs_mapping_scope_fk;
ALTER TABLE integration_import_jobs
  ADD CONSTRAINT integration_import_jobs_mapping_scope_fk
  FOREIGN KEY(mapping_id, tenant_id, branch_id)
  REFERENCES integration_import_mappings(id, tenant_id, branch_id);
