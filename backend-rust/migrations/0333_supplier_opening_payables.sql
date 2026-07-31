CREATE TABLE IF NOT EXISTS supplier_opening_payable_imports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  import_job_id TEXT NOT NULL REFERENCES integration_import_jobs(id) ON DELETE RESTRICT,
  source_file_id TEXT NOT NULL,
  cutover_id TEXT NOT NULL,
  source_checksum TEXT NOT NULL CHECK(source_checksum ~ '^[0-9A-Fa-f]{64}$'),
  source_outstanding_total_paise BIGINT NOT NULL CHECK(source_outstanding_total_paise >= 0),
  opening_balance_account TEXT NOT NULL
    CHECK(opening_balance_account IN ('OWNER_EQUITY','RETAINED_EARNINGS')),
  journal_entry_id TEXT REFERENCES accounting_journal_entries(id) ON DELETE RESTRICT,
  approved_by TEXT NOT NULL REFERENCES users(id),
  applied_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(import_job_id),
  UNIQUE(tenant_id,branch_id,cutover_id,source_checksum),
  FOREIGN KEY(tenant_id,branch_id,source_file_id)
    REFERENCES integration_import_source_files(tenant_id,branch_id,id) ON DELETE RESTRICT,
  CHECK((applied_at IS NULL)=(journal_entry_id IS NULL))
);

CREATE TABLE IF NOT EXISTS supplier_opening_payables (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  opening_import_id TEXT NOT NULL REFERENCES supplier_opening_payable_imports(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL,
  balance_side TEXT NOT NULL CHECK(balance_side IN ('debit','credit')),
  amount_paise BIGINT NOT NULL CHECK(amount_paise > 0),
  due_date DATE,
  gst_paise BIGINT NOT NULL DEFAULT 0 CHECK(gst_paise=0),
  source_row_number INTEGER NOT NULL CHECK(source_row_number > 0),
  source_row_checksum TEXT NOT NULL CHECK(source_row_checksum ~ '^[0-9A-Fa-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(opening_import_id,source_row_number),
  UNIQUE(opening_import_id,external_id),
  UNIQUE(opening_import_id,supplier_id)
);

CREATE TABLE IF NOT EXISTS supplier_opening_payable_allocations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  opening_payable_id TEXT NOT NULL REFERENCES supplier_opening_payables(id) ON DELETE RESTRICT,
  historical_bill_id TEXT NOT NULL REFERENCES historical_purchase_bills(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK(amount_paise > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(opening_payable_id,historical_bill_id),
  UNIQUE(historical_bill_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_opening_payables_scope
  ON supplier_opening_payables(tenant_id,branch_id,supplier_id,due_date);
CREATE INDEX IF NOT EXISTS idx_supplier_opening_payable_allocations_scope
  ON supplier_opening_payable_allocations(tenant_id,branch_id,opening_payable_id);

CREATE OR REPLACE FUNCTION validate_supplier_opening_payable_scope()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant TEXT;
  v_branch TEXT;
BEGIN
  IF TG_TABLE_NAME='supplier_opening_payable_imports' THEN
    IF NOT EXISTS(
      SELECT 1 FROM integration_import_jobs job
      JOIN integration_migration_cutovers cutover
        ON cutover.tenant_id::TEXT=job.tenant_id AND cutover.branch_id::TEXT=job.branch_id
       AND cutover.id=NEW.cutover_id AND cutover.status='snapshot_applied'
      WHERE job.id=NEW.import_job_id AND job.tenant_id=NEW.tenant_id
        AND job.branch_id=NEW.branch_id AND job.entity='opening-payables'
        AND job.source_file_id=NEW.source_file_id AND job.source_hash=NEW.source_checksum
        AND job.approval_decided_by=NEW.approved_by
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_IMPORT_CONTRACT_INVALID';
    END IF;
  ELSIF TG_TABLE_NAME='supplier_opening_payables' THEN
    SELECT tenant_id,branch_id INTO v_tenant,v_branch
      FROM supplier_opening_payable_imports WHERE id=NEW.opening_import_id;
    IF v_tenant IS DISTINCT FROM NEW.tenant_id OR v_branch IS DISTINCT FROM NEW.branch_id
       OR NOT EXISTS(SELECT 1 FROM suppliers supplier WHERE supplier.id=NEW.supplier_id
         AND supplier.tenant_id=NEW.tenant_id AND supplier.branch_id=NEW.branch_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_SCOPE_MISMATCH';
    END IF;
  ELSE
    SELECT line.tenant_id,line.branch_id INTO v_tenant,v_branch
      FROM supplier_opening_payables line WHERE line.id=NEW.opening_payable_id;
    IF v_tenant IS DISTINCT FROM NEW.tenant_id OR v_branch IS DISTINCT FROM NEW.branch_id
       OR NOT EXISTS(SELECT 1 FROM historical_purchase_bills bill
         WHERE bill.id=NEW.historical_bill_id AND bill.tenant_id=NEW.tenant_id
           AND bill.branch_id=NEW.branch_id
           AND LOWER(BTRIM(bill.payment_status)) NOT IN ('paid','settled')) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_ALLOCATION_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_opening_payable_import_scope
  ON supplier_opening_payable_imports;
CREATE TRIGGER trg_supplier_opening_payable_import_scope
BEFORE INSERT ON supplier_opening_payable_imports
FOR EACH ROW EXECUTE FUNCTION validate_supplier_opening_payable_scope();

DROP TRIGGER IF EXISTS trg_supplier_opening_payable_scope ON supplier_opening_payables;
CREATE TRIGGER trg_supplier_opening_payable_scope
BEFORE INSERT ON supplier_opening_payables
FOR EACH ROW EXECUTE FUNCTION validate_supplier_opening_payable_scope();

DROP TRIGGER IF EXISTS trg_supplier_opening_payable_allocation_scope
  ON supplier_opening_payable_allocations;
CREATE TRIGGER trg_supplier_opening_payable_allocation_scope
BEFORE INSERT ON supplier_opening_payable_allocations
FOR EACH ROW EXECUTE FUNCTION validate_supplier_opening_payable_scope();

CREATE OR REPLACE FUNCTION protect_supplier_opening_payable_evidence()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP='DELETE' OR TG_TABLE_NAME<>'supplier_opening_payable_imports'
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.import_job_id IS DISTINCT FROM OLD.import_job_id
     OR NEW.source_file_id IS DISTINCT FROM OLD.source_file_id
     OR NEW.cutover_id IS DISTINCT FROM OLD.cutover_id
     OR NEW.source_checksum IS DISTINCT FROM OLD.source_checksum
     OR NEW.source_outstanding_total_paise IS DISTINCT FROM OLD.source_outstanding_total_paise
     OR NEW.opening_balance_account IS DISTINCT FROM OLD.opening_balance_account
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_EVIDENCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_opening_payable_import_protect ON supplier_opening_payable_imports;
CREATE TRIGGER trg_supplier_opening_payable_import_protect
BEFORE UPDATE OR DELETE ON supplier_opening_payable_imports
FOR EACH ROW EXECUTE FUNCTION protect_supplier_opening_payable_evidence();

DROP TRIGGER IF EXISTS trg_supplier_opening_payable_protect ON supplier_opening_payables;
CREATE TRIGGER trg_supplier_opening_payable_protect
BEFORE UPDATE OR DELETE ON supplier_opening_payables
FOR EACH ROW EXECUTE FUNCTION protect_supplier_opening_payable_evidence();

DROP TRIGGER IF EXISTS trg_supplier_opening_payable_allocation_protect ON supplier_opening_payable_allocations;
CREATE TRIGGER trg_supplier_opening_payable_allocation_protect
BEFORE UPDATE OR DELETE ON supplier_opening_payable_allocations
FOR EACH ROW EXECUTE FUNCTION protect_supplier_opening_payable_evidence();
