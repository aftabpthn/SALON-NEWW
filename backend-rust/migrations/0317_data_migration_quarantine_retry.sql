ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_status_check;

ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_status_check
  CHECK(status IN (
    'ready','validated','warning','approval_required','duplicate','dependency_pending',
    'quarantined','error','imported','created','merged','linked','kept','failed','rolled_back'
  ));

ALTER TABLE integration_import_row_results
  ADD COLUMN IF NOT EXISTS correction_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS retry_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  ADD COLUMN IF NOT EXISTS last_retry_error TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;

UPDATE integration_import_row_results
SET status='quarantined',
    retry_eligible=TRUE,
    quarantined_at=COALESCE(quarantined_at,updated_at,created_at)
WHERE status='error';

CREATE INDEX IF NOT EXISTS idx_integration_import_row_results_quarantine
  ON integration_import_row_results(tenant_id,branch_id,job_id,status,source_row_number)
  WHERE status IN ('quarantined','failed','dependency_pending','approval_required','duplicate');
