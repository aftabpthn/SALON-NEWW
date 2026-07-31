ALTER TABLE integration_import_upload_sessions
  DROP CONSTRAINT IF EXISTS integration_import_upload_sessions_file_extension_check;
ALTER TABLE integration_import_upload_sessions
  ADD CONSTRAINT integration_import_upload_sessions_file_extension_check
  CHECK(file_extension IN ('csv','xlsx','zip','pdf','png','jpg','jpeg','webp'));

ALTER TABLE integration_import_source_files
  DROP CONSTRAINT IF EXISTS integration_import_source_files_file_extension_check;
ALTER TABLE integration_import_source_files
  ADD CONSTRAINT integration_import_source_files_file_extension_check
  CHECK(file_extension IN ('csv','xlsx','zip','pdf','png','jpg','jpeg','webp'));
ALTER TABLE integration_import_source_files
  DROP CONSTRAINT IF EXISTS integration_import_source_files_file_format_check;
ALTER TABLE integration_import_source_files
  ADD CONSTRAINT integration_import_source_files_file_format_check
  CHECK(file_format IN ('csv','xlsx','zip','pdf','png','jpeg','webp'));

ALTER TABLE integration_import_upload_sessions
  ADD COLUMN IF NOT EXISTS evidence_kind TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_batch TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cutover_id TEXT NOT NULL DEFAULT '';
ALTER TABLE integration_import_upload_sessions
  ADD CONSTRAINT integration_import_upload_sessions_evidence_kind_check
  CHECK(evidence_kind IN ('','historical_bill','physical_inventory','supplier_outstanding')),
  ADD CONSTRAINT integration_import_upload_sessions_supplier_batch_check
  CHECK((evidence_kind='historical_bill')=(supplier_batch<>''));

ALTER TABLE integration_import_source_files
  ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0 CHECK(page_count>=0);
ALTER TABLE integration_import_source_artifacts
  ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0 CHECK(page_count>=0);

CREATE TABLE IF NOT EXISTS historical_purchase_evidence_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cutover_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('historical_bill','physical_inventory','supplier_outstanding')),
  supplier_batch TEXT NOT NULL DEFAULT '',
  page_count INTEGER NOT NULL CHECK(page_count>=0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,branch_id,cutover_id,source_file_id),
  CHECK((evidence_kind='historical_bill')=(supplier_batch<>'')),
  FOREIGN KEY(tenant_id,branch_id,source_file_id)
    REFERENCES integration_import_source_files(tenant_id,branch_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_historical_purchase_evidence_scope
  ON historical_purchase_evidence_items(tenant_id,branch_id,cutover_id,evidence_kind,created_at);

CREATE TABLE IF NOT EXISTS historical_purchase_group_decisions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cutover_id TEXT NOT NULL,
  supplier_batch TEXT NOT NULL,
  group_key TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  approved_page_count INTEGER NOT NULL CHECK(approved_page_count>0),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historical_purchase_group_decisions_scope
  ON historical_purchase_group_decisions(tenant_id,branch_id,cutover_id,supplier_batch,group_key,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS historical_purchase_cutover_approvals (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cutover_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,branch_id,cutover_id)
);

CREATE OR REPLACE FUNCTION protect_historical_purchase_evidence_control()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HISTORICAL_PURCHASE_EVIDENCE_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION block_duplicate_historical_purchase_evidence()
RETURNS TRIGGER AS $$
DECLARE
  v_sha256 TEXT;
BEGIN
  SELECT sha256 INTO v_sha256
  FROM integration_import_source_files
  WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND id=NEW.source_file_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id||E'\n'||NEW.branch_id||E'\n'||v_sha256,0));
  IF EXISTS(
    SELECT 1
    FROM historical_purchase_evidence_items item
    JOIN integration_import_source_files source
      ON source.tenant_id=item.tenant_id AND source.branch_id=item.branch_id AND source.id=item.source_file_id
    WHERE item.tenant_id=NEW.tenant_id AND item.branch_id=NEW.branch_id AND source.sha256=v_sha256
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='HISTORICAL_PURCHASE_EVIDENCE_DUPLICATE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_historical_purchase_evidence_cutover()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM integration_migration_cutovers cutover
    WHERE cutover.tenant_id::TEXT=NEW.tenant_id
      AND cutover.branch_id::TEXT=NEW.branch_id
      AND cutover.id=NEW.cutover_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HISTORICAL_PURCHASE_EVIDENCE_CUTOVER_NOT_FOUND';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historical_purchase_evidence_duplicate ON historical_purchase_evidence_items;
CREATE TRIGGER trg_historical_purchase_evidence_duplicate
BEFORE INSERT ON historical_purchase_evidence_items
FOR EACH ROW EXECUTE FUNCTION block_duplicate_historical_purchase_evidence();
DROP TRIGGER IF EXISTS trg_historical_purchase_evidence_cutover ON historical_purchase_evidence_items;
CREATE TRIGGER trg_historical_purchase_evidence_cutover
BEFORE INSERT ON historical_purchase_evidence_items
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_evidence_cutover();
DROP TRIGGER IF EXISTS trg_historical_purchase_group_decisions_cutover ON historical_purchase_group_decisions;
CREATE TRIGGER trg_historical_purchase_group_decisions_cutover
BEFORE INSERT ON historical_purchase_group_decisions
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_evidence_cutover();
DROP TRIGGER IF EXISTS trg_historical_purchase_cutover_approvals_scope ON historical_purchase_cutover_approvals;
CREATE TRIGGER trg_historical_purchase_cutover_approvals_scope
BEFORE INSERT ON historical_purchase_cutover_approvals
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_evidence_cutover();

DROP TRIGGER IF EXISTS trg_historical_purchase_evidence_immutable ON historical_purchase_evidence_items;
CREATE TRIGGER trg_historical_purchase_evidence_immutable
BEFORE UPDATE OR DELETE ON historical_purchase_evidence_items
FOR EACH ROW EXECUTE FUNCTION protect_historical_purchase_evidence_control();
DROP TRIGGER IF EXISTS trg_historical_purchase_group_decisions_immutable ON historical_purchase_group_decisions;
CREATE TRIGGER trg_historical_purchase_group_decisions_immutable
BEFORE UPDATE OR DELETE ON historical_purchase_group_decisions
FOR EACH ROW EXECUTE FUNCTION protect_historical_purchase_evidence_control();
DROP TRIGGER IF EXISTS trg_historical_purchase_cutover_approvals_immutable ON historical_purchase_cutover_approvals;
CREATE TRIGGER trg_historical_purchase_cutover_approvals_immutable
BEFORE UPDATE OR DELETE ON historical_purchase_cutover_approvals
FOR EACH ROW EXECUTE FUNCTION protect_historical_purchase_evidence_control();
