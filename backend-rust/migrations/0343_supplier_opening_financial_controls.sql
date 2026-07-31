ALTER TABLE supplier_opening_payable_imports
  DROP CONSTRAINT IF EXISTS supplier_opening_payable_imports_source_outstanding_total_paise_check;

ALTER TABLE supplier_opening_payable_imports
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS payable_account TEXT NOT NULL DEFAULT 'ACCOUNTS_PAYABLE'
    CHECK(payable_account='ACCOUNTS_PAYABLE'),
  ADD COLUMN IF NOT EXISTS supplier_advance_account TEXT NOT NULL DEFAULT 'SUPPLIER_ADVANCE_ASSET'
    CHECK(supplier_advance_account='SUPPLIER_ADVANCE_ASSET'),
  ADD COLUMN IF NOT EXISTS finance_approved_by TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS finance_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_approved_at TIMESTAMPTZ;

UPDATE supplier_opening_payable_imports
   SET finance_approved_by=COALESCE(finance_approved_by,approved_by),
       finance_approved_at=COALESCE(finance_approved_at,created_at),
       owner_approved_at=COALESCE(owner_approved_at,created_at);

ALTER TABLE supplier_opening_payable_imports
  ALTER COLUMN finance_approved_by SET NOT NULL,
  ALTER COLUMN finance_approved_at SET NOT NULL,
  ALTER COLUMN owner_approved_at SET NOT NULL;

ALTER TABLE supplier_opening_payables
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS unallocated_paise BIGINT NOT NULL DEFAULT 0 CHECK(unallocated_paise >= 0),
  ADD COLUMN IF NOT EXISTS unallocated_approved BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE supplier_opening_payables line
   SET unallocated_paise=line.amount_paise-COALESCE((
         SELECT SUM(allocation.amount_paise)
           FROM supplier_opening_payable_allocations allocation
          WHERE allocation.opening_payable_id=line.id
       ),0),
       unallocated_approved=line.amount_paise>COALESCE((
         SELECT SUM(allocation.amount_paise)
           FROM supplier_opening_payable_allocations allocation
          WHERE allocation.opening_payable_id=line.id
       ),0);

ALTER TABLE supplier_opening_payables
  ADD CONSTRAINT supplier_opening_payables_unallocated_approval_check
  CHECK(unallocated_paise=0 OR unallocated_approved);

ALTER TABLE supplier_opening_payable_allocations
  ADD COLUMN IF NOT EXISTS rolled_back_at TIMESTAMPTZ;
ALTER TABLE supplier_opening_payable_allocations
  DROP CONSTRAINT IF EXISTS supplier_opening_payable_allocations_historical_bill_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_opening_payable_active_historical_bill
  ON supplier_opening_payable_allocations(historical_bill_id)
  WHERE rolled_back_at IS NULL;

ALTER TABLE supplier_payments ALTER COLUMN purchase_receipt_id DROP NOT NULL;
ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS opening_payable_id TEXT
    REFERENCES supplier_opening_payables(id) ON DELETE RESTRICT;
ALTER TABLE supplier_payments
  ADD CONSTRAINT supplier_payments_single_payable_source_check
  CHECK((purchase_receipt_id IS NOT NULL)::INTEGER+(opening_payable_id IS NOT NULL)::INTEGER=1);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_opening_payable
  ON supplier_payments(tenant_id,branch_id,opening_payable_id,paid_at DESC)
  WHERE opening_payable_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_supplier_opening_payable_scope()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant TEXT;
  v_branch TEXT;
  v_supplier TEXT;
  v_currency TEXT;
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
        AND job.approval_decided_at=NEW.owner_approved_at
        AND job.analysis_json->'openingPayableControls'->>'financeApproved'='true'
        AND job.analysis_json->'openingPayableControls'->>'approvedBy'=NEW.finance_approved_by
        AND (job.analysis_json->'openingPayableControls'->>'approvedAt')::TIMESTAMPTZ=NEW.finance_approved_at
        AND job.analysis_json->'openingPayableControls'->>'sourceHash'=NEW.source_checksum
        AND job.analysis_json->'openingPayableControls'->>'openingBalanceAccount'=NEW.opening_balance_account
        AND job.analysis_json->'openingPayableControls'->>'payableAccount'=NEW.payable_account
        AND job.analysis_json->'openingPayableControls'->>'supplierAdvanceAccount'=NEW.supplier_advance_account
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_IMPORT_CONTRACT_INVALID';
    END IF;
  ELSIF TG_TABLE_NAME='supplier_opening_payables' THEN
    SELECT tenant_id,branch_id,currency INTO v_tenant,v_branch,v_currency
      FROM supplier_opening_payable_imports WHERE id=NEW.opening_import_id;
    IF v_tenant IS DISTINCT FROM NEW.tenant_id OR v_branch IS DISTINCT FROM NEW.branch_id
       OR v_currency IS DISTINCT FROM NEW.currency
       OR NOT EXISTS(SELECT 1 FROM suppliers supplier WHERE supplier.id=NEW.supplier_id
         AND supplier.tenant_id=NEW.tenant_id AND supplier.branch_id=NEW.branch_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_SCOPE_MISMATCH';
    END IF;
  ELSE
    SELECT line.tenant_id,line.branch_id,line.supplier_id INTO v_tenant,v_branch,v_supplier
      FROM supplier_opening_payables line WHERE line.id=NEW.opening_payable_id;
    IF v_tenant IS DISTINCT FROM NEW.tenant_id OR v_branch IS DISTINCT FROM NEW.branch_id
       OR NEW.rolled_back_at IS NOT NULL
       OR NOT EXISTS(
         SELECT 1 FROM historical_purchase_bills bill
         JOIN historical_purchase_identity_mappings mapping
           ON mapping.tenant_id=bill.tenant_id AND mapping.branch_id=bill.branch_id
          AND mapping.identity_type='vendor' AND mapping.provider=bill.provider
          AND mapping.source_key=ENCODE(DIGEST(CONCAT_WS('|',bill.provider,CASE
            WHEN BTRIM(bill.supplier_external_id)<>'' THEN 'provider:'||LOWER(BTRIM(bill.supplier_external_id))
            WHEN BTRIM(bill.supplier_gstin)<>'' THEN 'gstin:'||UPPER(BTRIM(bill.supplier_gstin))
            WHEN BTRIM(bill.supplier_code)<>'' THEN 'code:'||LOWER(BTRIM(bill.supplier_code))
            ELSE CONCAT_WS(':','attributes',REGEXP_REPLACE(LOWER(BTRIM(bill.supplier_name)),'[^a-z0-9]+','','g'),REGEXP_REPLACE(LOWER(BTRIM(bill.supplier_phone)),'[^0-9]+','','g'),LOWER(BTRIM(bill.supplier_email))) END),'sha256'),'hex')
          AND mapping.current_decision IN ('link','create') AND mapping.target_supplier_id=v_supplier
        WHERE bill.id=NEW.historical_bill_id AND bill.tenant_id=NEW.tenant_id
          AND bill.branch_id=NEW.branch_id
          AND LOWER(BTRIM(bill.payment_status)) NOT IN ('paid','settled')
          AND LOWER(BTRIM(bill.source_status)) NOT IN ('cancelled','canceled','void','voided','rejected')
          AND LOWER(BTRIM(bill.document_type)) NOT IN ('cancelled','canceled','void','voided')
          AND NEW.amount_paise<=GREATEST(bill.total_paise,0)
       ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_ALLOCATION_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_supplier_opening_payable_evidence()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME='supplier_opening_payable_allocations' AND TG_OP='UPDATE'
     AND NEW.tenant_id=OLD.tenant_id AND NEW.branch_id=OLD.branch_id
     AND NEW.opening_payable_id=OLD.opening_payable_id
     AND NEW.historical_bill_id=OLD.historical_bill_id AND NEW.amount_paise=OLD.amount_paise
     AND OLD.rolled_back_at IS NULL AND NEW.rolled_back_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR TG_TABLE_NAME<>'supplier_opening_payable_imports'
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.import_job_id IS DISTINCT FROM OLD.import_job_id
     OR NEW.source_file_id IS DISTINCT FROM OLD.source_file_id
     OR NEW.cutover_id IS DISTINCT FROM OLD.cutover_id
     OR NEW.source_checksum IS DISTINCT FROM OLD.source_checksum
     OR NEW.source_outstanding_total_paise IS DISTINCT FROM OLD.source_outstanding_total_paise
     OR NEW.opening_balance_account IS DISTINCT FROM OLD.opening_balance_account
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.payable_account IS DISTINCT FROM OLD.payable_account
     OR NEW.supplier_advance_account IS DISTINCT FROM OLD.supplier_advance_account
     OR NEW.finance_approved_by IS DISTINCT FROM OLD.finance_approved_by
     OR NEW.finance_approved_at IS DISTINCT FROM OLD.finance_approved_at
     OR NEW.owner_approved_at IS DISTINCT FROM OLD.owner_approved_at
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_EVIDENCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION migration_cutover_full_reconciliation(TEXT,TEXT,TEXT)
  RENAME TO migration_cutover_full_reconciliation_phase5;

CREATE FUNCTION migration_cutover_full_reconciliation(
  p_tenant TEXT,
  p_branch TEXT,
  p_cutover TEXT
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_blockers JSONB;
  v_opening_mismatch BOOLEAN;
BEGIN
  v_result:=migration_cutover_full_reconciliation_phase5(p_tenant,p_branch,p_cutover);
  SELECT COALESCE(JSONB_AGG(value ORDER BY value),'[]'::JSONB) INTO v_blockers
    FROM JSONB_ARRAY_ELEMENTS_TEXT(v_result->'blockers') item(value)
   WHERE value<>'OPENING_PAYABLE_MISMATCH';

  SELECT EXISTS(
    SELECT 1 FROM supplier_opening_payable_imports opening
    WHERE opening.tenant_id=p_tenant AND opening.branch_id=p_branch AND opening.cutover_id=p_cutover
      AND (opening.rolled_back_at IS NOT NULL OR opening.journal_entry_id IS NULL
        OR opening.source_outstanding_total_paise<>(SELECT COALESCE(SUM(
          CASE line.balance_side WHEN 'credit' THEN line.amount_paise ELSE -line.amount_paise END),0)::BIGINT
          FROM supplier_opening_payables line WHERE line.opening_import_id=opening.id)
        OR EXISTS(SELECT 1 FROM supplier_opening_payables line WHERE line.opening_import_id=opening.id
          AND (line.gst_paise<>0 OR line.currency<>opening.currency
            OR line.amount_paise<>line.unallocated_paise+(SELECT COALESCE(SUM(allocation.amount_paise),0)::BIGINT
              FROM supplier_opening_payable_allocations allocation
             WHERE allocation.opening_payable_id=line.id AND allocation.rolled_back_at IS NULL)
            OR (line.unallocated_paise>0 AND NOT line.unallocated_approved))))
  ) INTO v_opening_mismatch;
  IF v_opening_mismatch THEN
    v_blockers:=v_blockers||JSONB_BUILD_ARRAY('OPENING_PAYABLE_MISMATCH');
  END IF;
  v_result:=JSONB_SET(v_result,'{blockers}',v_blockers);
  RETURN JSONB_SET(v_result,'{status}',TO_JSONB(CASE WHEN JSONB_ARRAY_LENGTH(v_blockers)=0 THEN 'matched' ELSE 'blocked' END));
END;
$$ LANGUAGE plpgsql STABLE;
