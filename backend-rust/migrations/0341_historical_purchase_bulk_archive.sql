CREATE TABLE IF NOT EXISTS historical_purchase_archive_batches (
  job_id TEXT PRIMARY KEY REFERENCES integration_import_jobs(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cutover_id TEXT NOT NULL,
  supplier_batch TEXT NOT NULL,
  provider TEXT NOT NULL,
  posting_mode TEXT NOT NULL DEFAULT 'history_only' CHECK(posting_mode='history_only'),
  expected_bill_count INTEGER NOT NULL CHECK(expected_bill_count > 0),
  expected_total_paise BIGINT,
  mapping_version INTEGER NOT NULL CHECK(mapping_version > 0),
  transformer_version TEXT NOT NULL,
  worker_limit INTEGER NOT NULL DEFAULT 4 CHECK(worker_limit BETWEEN 1 AND 4),
  partial_approval BOOLEAN NOT NULL DEFAULT FALSE,
  partial_approved_by TEXT REFERENCES users(id),
  partial_approved_at TIMESTAMPTZ,
  partial_approval_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,branch_id,job_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_purchase_archive_batches_scope
  ON historical_purchase_archive_batches(tenant_id,branch_id,created_at DESC);

CREATE TABLE IF NOT EXISTS historical_purchase_archive_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES historical_purchase_archive_batches(job_id) ON DELETE RESTRICT,
  source_file_id TEXT NOT NULL,
  source_artifact_id TEXT REFERENCES integration_import_source_artifacts(id) ON DELETE RESTRICT,
  draft_id TEXT NOT NULL REFERENCES purchase_bill_drafts(id) ON DELETE RESTRICT,
  pilot_document BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK(status IN (
    'uploaded','profiling','extracting','review_required','ready','archived',
    'duplicate','quarantined','failed','dependency_pending','rejected','cancelled'
  )),
  source_page_count INTEGER NOT NULL DEFAULT 0 CHECK(source_page_count >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  retry_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  next_retry_at TIMESTAMPTZ,
  worker_id TEXT NOT NULL DEFAULT '',
  heartbeat_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  suggested_correction TEXT NOT NULL DEFAULT '',
  duplicate_of_historical_bill_id TEXT REFERENCES historical_purchase_bills(id) ON DELETE RESTRICT,
  archived_historical_bill_id TEXT REFERENCES historical_purchase_bills(id) ON DELETE RESTRICT,
  source_total_paise BIGINT,
  archive_total_paise BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(tenant_id,branch_id,job_id,id),
  UNIQUE(tenant_id,branch_id,source_file_id,source_artifact_id),
  FOREIGN KEY(tenant_id,branch_id,source_file_id)
    REFERENCES integration_import_source_files(tenant_id,branch_id,id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_purchase_archive_items_source
  ON historical_purchase_archive_items(
    tenant_id,branch_id,source_file_id,COALESCE(source_artifact_id,'')
  );
CREATE INDEX IF NOT EXISTS idx_historical_purchase_archive_items_claim
  ON historical_purchase_archive_items(status,next_retry_at,lease_expires_at,created_at)
  WHERE status IN ('uploaded','failed','profiling','extracting');
CREATE INDEX IF NOT EXISTS idx_historical_purchase_archive_items_batch
  ON historical_purchase_archive_items(tenant_id,branch_id,job_id,status,created_at);

CREATE OR REPLACE FUNCTION validate_historical_purchase_archive_batch_item()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM integration_migration_cutovers cutover
    WHERE cutover.tenant_id::TEXT=NEW.tenant_id
      AND cutover.branch_id::TEXT=NEW.branch_id
      AND cutover.id=(
        SELECT cutover_id FROM historical_purchase_archive_batches
        WHERE job_id=NEW.job_id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_BULK_CUTOVER_NOT_FOUND';
  END IF;
  IF NOT EXISTS(
    SELECT 1
    FROM historical_purchase_archive_batches batch
    JOIN integration_import_jobs job
      ON job.id=batch.job_id
     AND job.tenant_id=batch.tenant_id
     AND job.branch_id=batch.branch_id
    WHERE batch.job_id=NEW.job_id
      AND batch.tenant_id=NEW.tenant_id
      AND batch.branch_id=NEW.branch_id
      AND batch.posting_mode='history_only'
      AND job.entity='purchase-bills'
      AND job.mode='commit'
      AND job.worker_phase='historical_archive'
      AND job.source_file_id=NEW.source_file_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_BULK_SCOPE_MISMATCH';
  END IF;
  IF NEW.source_artifact_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM integration_import_source_artifacts artifact
    WHERE artifact.id=NEW.source_artifact_id
      AND artifact.tenant_id=NEW.tenant_id
      AND artifact.branch_id=NEW.branch_id
      AND artifact.source_file_id=NEW.source_file_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_BULK_ARTIFACT_SCOPE_MISMATCH';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM purchase_bill_drafts draft
    WHERE draft.id=NEW.draft_id
      AND draft.tenant_id=NEW.tenant_id
      AND draft.branch_id=NEW.branch_id
      AND draft.workflow_mode='historical_pilot'
      AND draft.migration_source_file_id=NEW.source_file_id
      AND draft.migration_source_artifact_id IS NOT DISTINCT FROM NEW.source_artifact_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_BULK_DRAFT_SCOPE_MISMATCH';
  END IF;
  IF (NEW.status='archived') <> (NEW.archived_historical_bill_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_BULK_ARCHIVE_STATE_INVALID';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historical_purchase_archive_item_guard
  ON historical_purchase_archive_items;
CREATE TRIGGER trg_historical_purchase_archive_item_guard
BEFORE INSERT OR UPDATE ON historical_purchase_archive_items
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_archive_batch_item();
