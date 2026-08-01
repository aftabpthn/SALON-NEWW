CREATE TABLE IF NOT EXISTS historical_purchase_evidence_corrections (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cutover_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('correct_supplier','exclude','restore')),
  supplier_batch TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL CHECK(CHAR_LENGTH(TRIM(reason)) BETWEEN 5 AND 500),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK((action='correct_supplier')=(supplier_batch<>'')),
  FOREIGN KEY(tenant_id,branch_id,cutover_id,source_file_id)
    REFERENCES historical_purchase_evidence_items(tenant_id,branch_id,cutover_id,source_file_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_historical_purchase_evidence_corrections_scope
  ON historical_purchase_evidence_corrections(
    tenant_id,branch_id,cutover_id,source_file_id,created_at DESC,id DESC
  );

CREATE OR REPLACE FUNCTION validate_historical_purchase_evidence_correction()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1
    FROM historical_purchase_evidence_items evidence
    JOIN integration_migration_cutovers cutover
      ON cutover.tenant_id::TEXT=evidence.tenant_id
     AND cutover.branch_id::TEXT=evidence.branch_id
     AND cutover.id=evidence.cutover_id
    WHERE evidence.tenant_id=NEW.tenant_id
      AND evidence.branch_id=NEW.branch_id
      AND evidence.cutover_id=NEW.cutover_id
      AND evidence.source_file_id=NEW.source_file_id
      AND evidence.evidence_kind='historical_bill'
      AND cutover.status IN ('draft','history_importing')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_EVIDENCE_CORRECTION_NOT_ALLOWED';
  END IF;

  IF EXISTS(
    SELECT 1 FROM purchase_bill_drafts draft
    WHERE draft.tenant_id=NEW.tenant_id
      AND draft.branch_id=NEW.branch_id
      AND draft.migration_cutover_id=NEW.cutover_id
      AND draft.migration_source_file_id=NEW.source_file_id
    UNION ALL
    SELECT 1 FROM historical_purchase_archive_items item
    WHERE item.tenant_id=NEW.tenant_id
      AND item.branch_id=NEW.branch_id
      AND item.source_file_id=NEW.source_file_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_EVIDENCE_ALREADY_IN_USE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historical_purchase_evidence_corrections_validate
  ON historical_purchase_evidence_corrections;
CREATE TRIGGER trg_historical_purchase_evidence_corrections_validate
BEFORE INSERT ON historical_purchase_evidence_corrections
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_evidence_correction();

DROP TRIGGER IF EXISTS trg_historical_purchase_evidence_corrections_immutable
  ON historical_purchase_evidence_corrections;
CREATE TRIGGER trg_historical_purchase_evidence_corrections_immutable
BEFORE UPDATE OR DELETE ON historical_purchase_evidence_corrections
FOR EACH ROW EXECUTE FUNCTION protect_historical_purchase_evidence_control();

CREATE OR REPLACE FUNCTION block_excluded_historical_purchase_pilot()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workflow_mode='historical_pilot' AND COALESCE((
    SELECT correction.action
    FROM historical_purchase_evidence_corrections correction
    WHERE correction.tenant_id=NEW.tenant_id
      AND correction.branch_id=NEW.branch_id
      AND correction.cutover_id=NEW.migration_cutover_id
      AND correction.source_file_id=NEW.migration_source_file_id
      AND correction.action IN ('exclude','restore')
    ORDER BY correction.created_at DESC,correction.id DESC
    LIMIT 1
  ),'restore')='exclude' THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_EVIDENCE_EXCLUDED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historical_purchase_pilot_excluded_guard
  ON purchase_bill_drafts;
CREATE TRIGGER trg_historical_purchase_pilot_excluded_guard
BEFORE INSERT OR UPDATE ON purchase_bill_drafts
FOR EACH ROW EXECUTE FUNCTION block_excluded_historical_purchase_pilot();

CREATE OR REPLACE FUNCTION block_excluded_historical_purchase_archive()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT correction.action
    FROM historical_purchase_evidence_corrections correction
    WHERE correction.tenant_id=NEW.tenant_id
      AND correction.branch_id=NEW.branch_id
      AND correction.source_file_id=NEW.source_file_id
      AND correction.action IN ('exclude','restore')
    ORDER BY correction.created_at DESC,correction.id DESC
    LIMIT 1
  )='exclude' THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='HISTORICAL_PURCHASE_EVIDENCE_EXCLUDED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historical_purchase_archive_excluded_guard
  ON historical_purchase_archive_items;
CREATE TRIGGER trg_historical_purchase_archive_excluded_guard
BEFORE INSERT OR UPDATE ON historical_purchase_archive_items
FOR EACH ROW EXECUTE FUNCTION block_excluded_historical_purchase_archive();
