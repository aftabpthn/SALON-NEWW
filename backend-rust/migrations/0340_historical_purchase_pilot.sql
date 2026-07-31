ALTER TABLE purchase_bill_drafts
  DROP CONSTRAINT IF EXISTS purchase_bill_drafts_status_check;

ALTER TABLE purchase_bill_drafts
  ADD CONSTRAINT purchase_bill_drafts_status_check
  CHECK (status IN (
    'uploaded','extracting','review','reviewed','quarantined',
    'confirmed','cancelled','extraction_failed'
  ));

ALTER TABLE purchase_bill_drafts
  ALTER COLUMN source_bytes DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS workflow_mode TEXT NOT NULL DEFAULT 'live_receipt',
  ADD COLUMN IF NOT EXISTS migration_source_file_id TEXT,
  ADD COLUMN IF NOT EXISTS migration_source_artifact_id TEXT,
  ADD COLUMN IF NOT EXISTS migration_cutover_id TEXT,
  ADD COLUMN IF NOT EXISTS review_decision TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD CONSTRAINT purchase_bill_drafts_workflow_mode_check
    CHECK (workflow_mode IN ('live_receipt','historical_pilot')),
  ADD CONSTRAINT purchase_bill_drafts_review_decision_check
    CHECK (review_decision IN ('pending','approved','quarantined','rejected')),
  ADD CONSTRAINT purchase_bill_drafts_source_mode_check CHECK (
    (workflow_mode='live_receipt'
      AND source_bytes IS NOT NULL
      AND migration_source_file_id IS NULL
      AND migration_source_artifact_id IS NULL
      AND migration_cutover_id IS NULL)
    OR
    (workflow_mode='historical_pilot'
      AND source_bytes IS NULL
      AND migration_source_file_id IS NOT NULL
      AND migration_cutover_id IS NOT NULL)
  ),
  ADD CONSTRAINT purchase_bill_drafts_migration_source_fk
    FOREIGN KEY (tenant_id,branch_id,migration_source_file_id)
    REFERENCES integration_import_source_files(tenant_id,branch_id,id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT purchase_bill_drafts_migration_artifact_fk
    FOREIGN KEY (migration_source_artifact_id)
    REFERENCES integration_import_source_artifacts(id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_bill_historical_pilot_source
  ON purchase_bill_drafts(
    tenant_id,
    branch_id,
    migration_source_file_id,
    COALESCE(migration_source_artifact_id,'')
  )
  WHERE workflow_mode='historical_pilot';

CREATE INDEX IF NOT EXISTS idx_purchase_bill_historical_pilot
  ON purchase_bill_drafts(
    tenant_id,branch_id,migration_cutover_id,status,created_at DESC
  )
  WHERE workflow_mode='historical_pilot';

CREATE OR REPLACE FUNCTION validate_historical_purchase_pilot()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workflow_mode<>'historical_pilot' THEN
    RETURN NEW;
  END IF;

  IF NEW.status='confirmed' OR NEW.purchase_receipt_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_PILOT_CANNOT_POST_GRN';
  END IF;

  IF NOT EXISTS(
    SELECT 1
    FROM historical_purchase_evidence_items evidence
    JOIN historical_purchase_cutover_approvals approval
      ON approval.tenant_id=evidence.tenant_id
     AND approval.branch_id=evidence.branch_id
     AND approval.cutover_id=evidence.cutover_id
    WHERE evidence.tenant_id=NEW.tenant_id
      AND evidence.branch_id=NEW.branch_id
      AND evidence.cutover_id=NEW.migration_cutover_id
      AND evidence.source_file_id=NEW.migration_source_file_id
      AND evidence.evidence_kind='historical_bill'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_PILOT_EVIDENCE_NOT_APPROVED';
  END IF;

  IF NEW.migration_source_artifact_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM integration_import_source_artifacts artifact
    WHERE artifact.id=NEW.migration_source_artifact_id
      AND artifact.tenant_id=NEW.tenant_id
      AND artifact.branch_id=NEW.branch_id
      AND artifact.source_file_id=NEW.migration_source_file_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_PILOT_ARTIFACT_SCOPE_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historical_purchase_pilot_guard
  ON purchase_bill_drafts;
CREATE TRIGGER trg_historical_purchase_pilot_guard
BEFORE INSERT OR UPDATE ON purchase_bill_drafts
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_pilot();

