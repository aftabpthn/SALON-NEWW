ALTER TABLE integration_import_upload_sessions
  ADD COLUMN IF NOT EXISTS source_provider TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 90
    CHECK(retention_days BETWEEN 1 AND 3650);

ALTER TABLE integration_import_source_files
  ADD COLUMN IF NOT EXISTS source_provider TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS encryption_scheme TEXT NOT NULL DEFAULT 'none'
    CHECK(encryption_scheme IN ('none','aes-256-gcm-chunked-v1')),
  ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

ALTER TABLE integration_import_source_files
  DROP CONSTRAINT IF EXISTS integration_import_source_files_evidence_status_check;
ALTER TABLE integration_import_source_files
  ADD CONSTRAINT integration_import_source_files_evidence_status_check
  CHECK(evidence_status IN ('verified','quarantined','expired'));

CREATE OR REPLACE FUNCTION reject_integration_source_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.retention_until <= NOW()
     AND NEW.evidence_status = 'expired'
     AND NEW.purged_at IS NOT NULL
     AND (to_jsonb(NEW) - 'evidence_status' - 'purged_at')
         = (to_jsonb(OLD) - 'evidence_status' - 'purged_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'migration source evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_import_source_files_retention
  ON integration_import_source_files(tenant_id, branch_id, retention_until);
