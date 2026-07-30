CREATE TABLE IF NOT EXISTS integration_import_mapping_approvals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
  source_file_id TEXT,
  source_sheet TEXT NOT NULL DEFAULT '',
  source_column TEXT NOT NULL CHECK(LENGTH(BTRIM(source_column)) BETWEEN 1 AND 200),
  target_field TEXT NOT NULL CHECK(LENGTH(BTRIM(target_field)) BETWEEN 1 AND 120),
  confidence_percentage SMALLINT NOT NULL CHECK(confidence_percentage BETWEEN 65 AND 89),
  decision_json JSONB NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, branch_id, fingerprint, source_column, target_field)
);

CREATE INDEX IF NOT EXISTS idx_integration_import_mapping_approval_lookup
  ON integration_import_mapping_approvals(
    tenant_id, branch_id, fingerprint, source_column, target_field
  );
