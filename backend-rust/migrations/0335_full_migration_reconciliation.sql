CREATE TABLE IF NOT EXISTS integration_opening_inventory_accounting (
  snapshot_id TEXT PRIMARY KEY REFERENCES integration_opening_inventory_snapshots(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cutover_id TEXT NOT NULL,
  opening_valuation_paise BIGINT NOT NULL,
  journal_entry_id TEXT REFERENCES accounting_journal_entries(id) ON DELETE RESTRICT,
  approved_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ,
  CHECK ((opening_valuation_paise=0)=(journal_entry_id IS NULL)),
  UNIQUE(tenant_id,branch_id,cutover_id)
);

CREATE OR REPLACE FUNCTION protect_opening_inventory_accounting()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.cutover_id IS DISTINCT FROM OLD.cutover_id
     OR NEW.opening_valuation_paise IS DISTINCT FROM OLD.opening_valuation_paise
     OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
     OR OLD.rolled_back_at IS NOT NULL OR NEW.rolled_back_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_INVENTORY_ACCOUNTING_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_opening_inventory_accounting_protect ON integration_opening_inventory_accounting;
CREATE TRIGGER trg_opening_inventory_accounting_protect
BEFORE UPDATE OR DELETE ON integration_opening_inventory_accounting
FOR EACH ROW EXECUTE FUNCTION protect_opening_inventory_accounting();

CREATE OR REPLACE FUNCTION migration_cutover_full_reconciliation(
  p_tenant TEXT,
  p_branch TEXT,
  p_cutover TEXT
) RETURNS JSONB AS $$
DECLARE
  v_blockers JSONB;
  v_historical JSONB;
  v_inventory JSONB;
  v_accounting JSONB;
BEGIN
  WITH cutover_jobs AS (
    SELECT * FROM integration_import_jobs job
     WHERE job.tenant_id=p_tenant AND job.branch_id=p_branch
       AND job.analysis_json->'postingContract'->>'cutoverId'=p_cutover
  ), blockers AS (
    SELECT 'MISSING_REQUIRED_SNAPSHOT_PRODUCT' code WHERE NOT EXISTS(
      SELECT 1 FROM integration_opening_inventory_snapshots snapshot
       WHERE snapshot.tenant_id=p_tenant AND snapshot.branch_id=p_branch AND snapshot.cutover_id=p_cutover
    )
    UNION ALL SELECT 'UNEXPLAINED_STOCK_MISMATCH' WHERE EXISTS(
      SELECT 1 FROM integration_opening_inventory_snapshot_lines line
      JOIN integration_opening_inventory_snapshots snapshot ON snapshot.id=line.snapshot_id
      LEFT JOIN inventory_location_stock stock ON stock.tenant_id=line.tenant_id
       AND stock.branch_id=line.branch_id AND stock.inventory_item_id=line.inventory_item_id
       AND stock.location_code=line.location_code
      WHERE snapshot.tenant_id=p_tenant AND snapshot.branch_id=p_branch AND snapshot.cutover_id=p_cutover
        AND (line.expected_quantity IS DISTINCT FROM stock.quantity
          OR line.valuation_paise::NUMERIC<>line.quantity::NUMERIC*line.unit_cost_paise::NUMERIC)
    )
    UNION ALL SELECT 'MISSING_REQUIRED_SNAPSHOT_PRODUCT' WHERE EXISTS(
      SELECT 1 FROM integration_import_row_results result JOIN cutover_jobs job ON job.id=result.job_id
       WHERE job.entity='inventory' AND result.error_code IN
         ('SNAPSHOT_PRODUCT_MAPPING_REQUIRED','REQUIRED_FIELD','DEPENDENCY_NOT_FOUND')
        AND result.status NOT IN ('imported','created','merged','linked','kept','rolled_back')
    )
    UNION ALL SELECT 'BATCH_OR_LOCATION_MISMATCH' WHERE EXISTS(
      SELECT 1 FROM integration_opening_inventory_snapshot_lines line
      JOIN integration_opening_inventory_snapshots snapshot ON snapshot.id=line.snapshot_id
      JOIN inventory_items item ON item.id=line.inventory_item_id
      WHERE snapshot.tenant_id=p_tenant AND snapshot.branch_id=p_branch AND snapshot.cutover_id=p_cutover
        AND (line.quantity<>line.approved_unbatched_quantity+
          COALESCE((SELECT SUM((batch->>'quantity')::INTEGER)
            FROM JSONB_ARRAY_ELEMENTS(line.batches_json) batch),0)
          OR (item.batch_tracked AND JSONB_ARRAY_LENGTH(line.batches_json)=0))
    )
    UNION ALL SELECT 'OPENING_PAYABLE_MISMATCH' WHERE EXISTS(
      SELECT 1 FROM supplier_opening_payable_imports opening
      WHERE opening.tenant_id=p_tenant AND opening.branch_id=p_branch AND opening.cutover_id=p_cutover
        AND (opening.rolled_back_at IS NOT NULL OR opening.journal_entry_id IS NULL
          OR opening.source_outstanding_total_paise<>(SELECT COALESCE(SUM(
            CASE line.balance_side WHEN 'credit' THEN line.amount_paise ELSE -line.amount_paise END),0)::BIGINT
            FROM supplier_opening_payables line WHERE line.opening_import_id=opening.id)
          OR EXISTS(SELECT 1 FROM supplier_opening_payables line WHERE line.opening_import_id=opening.id
            AND (line.gst_paise<>0 OR (EXISTS(SELECT 1 FROM supplier_opening_payable_allocations allocation
              WHERE allocation.opening_payable_id=line.id) AND line.amount_paise<>(SELECT COALESCE(SUM(allocation.amount_paise),0)::BIGINT
                FROM supplier_opening_payable_allocations allocation WHERE allocation.opening_payable_id=line.id))))
        )
    )
    UNION ALL SELECT 'OPENING_INVENTORY_JOURNAL_MISMATCH' WHERE EXISTS(
      SELECT 1 FROM integration_opening_inventory_snapshots snapshot
      LEFT JOIN integration_opening_inventory_accounting accounting ON accounting.snapshot_id=snapshot.id
      WHERE snapshot.tenant_id=p_tenant AND snapshot.branch_id=p_branch AND snapshot.cutover_id=p_cutover
        AND (accounting.snapshot_id IS NULL OR accounting.rolled_back_at IS NOT NULL
          OR accounting.opening_valuation_paise<>(SELECT COALESCE(SUM(line.valuation_paise),0)::BIGINT
             FROM integration_opening_inventory_snapshot_lines line WHERE line.snapshot_id=snapshot.id)
          OR (accounting.opening_valuation_paise<>0 AND accounting.journal_entry_id IS NULL))
    )
    UNION ALL SELECT 'DUPLICATE_LIVE_RECEIPT' WHERE EXISTS(
      SELECT 1 FROM cutover_jobs job WHERE job.entity='purchase-bills'
       AND job.analysis_json->'postingContract'->>'postingMode'='live_receipt'
       AND (job.duplicate_row_count>0 OR EXISTS(SELECT 1 FROM integration_import_row_results result
         WHERE result.job_id=job.id AND result.status='duplicate'))
    )
    UNION ALL SELECT 'UNAPPROVED_UNIT_CONVERSION' WHERE EXISTS(
      SELECT 1 FROM integration_import_row_results result JOIN cutover_jobs job ON job.id=result.job_id
       WHERE result.error_code IN ('STOCK_UNIT_CONVERSION_REQUIRED','UNIT_CONVERSION_APPROVAL_REQUIRED')
         AND result.status NOT IN ('imported','created','merged','linked','kept','rolled_back')
    )
    UNION ALL SELECT 'UNRESOLVED_RED_ROWS' WHERE EXISTS(
      SELECT 1 FROM integration_import_row_results result JOIN cutover_jobs job ON job.id=result.job_id
       WHERE result.status IN ('error','quarantined','failed')
          OR (result.error_code<>'' AND result.status NOT IN ('imported','created','merged','linked','kept','rolled_back'))
    )
  ) SELECT COALESCE(JSONB_AGG(DISTINCT code ORDER BY code),'[]'::JSONB) INTO v_blockers FROM blockers;

  WITH jobs AS (
    SELECT * FROM integration_import_jobs job WHERE job.tenant_id=p_tenant AND job.branch_id=p_branch
     AND job.entity='purchase-bills' AND job.analysis_json->'postingContract'->>'cutoverId'=p_cutover
     AND job.analysis_json->'postingContract'->>'postingMode'='history_only'
  ), source AS (
    SELECT result.* FROM integration_import_row_results result JOIN jobs job ON job.id=result.job_id
  ), archive_bills AS (
    SELECT * FROM historical_purchase_bills bill WHERE bill.tenant_id=p_tenant
      AND bill.branch_id=p_branch AND bill.cutover_id=p_cutover
  ), archive_lines AS (
    SELECT line.* FROM historical_purchase_bill_lines line JOIN archive_bills bill ON bill.id=line.historical_bill_id
  ) SELECT JSONB_BUILD_OBJECT(
    'sourceBillCount',(SELECT COUNT(DISTINCT CONCAT_WS('|',job_id,source_external_id)) FROM source),
    'archiveBillCount',(SELECT COUNT(*) FROM archive_bills),
    'sourceLineCount',(SELECT COUNT(*) FROM source),
    'readySourceLineCount',(SELECT COUNT(*) FROM source WHERE action='created'),
    'archiveLineCount',(SELECT COUNT(*) FROM archive_lines),
    'sourceTotals',JSONB_BUILD_OBJECT(
      'taxablePaise',(SELECT COALESCE(SUM((source_payload->>'taxable_paise')::BIGINT),0) FROM source WHERE action='created'),
      'cgstPaise',(SELECT COALESCE(SUM((source_payload->>'cgst_paise')::BIGINT),0) FROM source WHERE action='created'),
      'sgstPaise',(SELECT COALESCE(SUM((source_payload->>'sgst_paise')::BIGINT),0) FROM source WHERE action='created'),
      'igstPaise',(SELECT COALESCE(SUM((source_payload->>'igst_paise')::BIGINT),0) FROM source WHERE action='created')),
    'archiveTotals',JSONB_BUILD_OBJECT(
      'taxablePaise',(SELECT COALESCE(SUM(taxable_paise),0) FROM archive_lines),
      'cgstPaise',(SELECT COALESCE(SUM(cgst_paise),0) FROM archive_lines),
      'sgstPaise',(SELECT COALESCE(SUM(sgst_paise),0) FROM archive_lines),
      'igstPaise',(SELECT COALESCE(SUM(igst_paise),0) FROM archive_lines)),
    'vendorTotals',COALESCE((SELECT JSONB_AGG(TO_JSONB(vendor) ORDER BY vendor.supplier_name) FROM (
      SELECT supplier_name,MAX(supplier_gstin) supplier_gstin,COUNT(*) bill_count,
        SUM(total_paise)::BIGINT total_paise FROM archive_bills GROUP BY supplier_name) vendor),'[]'::JSONB),
    'productTotals',COALESCE((SELECT JSONB_AGG(TO_JSONB(product) ORDER BY product.product_name) FROM (
      SELECT COALESCE(MAX(mapped_inventory_item_id),MAX(original_product_name)) product_key,
        MAX(original_product_name) product_name,COUNT(*) line_count,SUM(purchased_quantity)::BIGINT quantity,
        SUM(total_paise)::BIGINT total_paise FROM archive_lines
       GROUP BY COALESCE(mapped_inventory_item_id,original_product_name)) product),'[]'::JSONB),
    'unmappedProducts',(SELECT COUNT(*) FROM archive_lines WHERE mapped_inventory_item_id IS NULL),
    'duplicateBills',(SELECT COUNT(*) FROM source WHERE error_code='DUPLICATE_HISTORICAL_PURCHASE_BILL'),
    'rejectedLines',(SELECT COUNT(*) FROM source WHERE status IN ('error','quarantined','failed')),
    'sourceAttachmentReferences',(SELECT COUNT(DISTINCT CONCAT_WS('|',job_id,source_external_id,source_payload->>'bill_file_name')) FROM source WHERE action='created' AND COALESCE(source_payload->>'bill_file_name','')<>''),
    'archiveAttachmentCount',(SELECT COUNT(*) FROM historical_purchase_bill_files file JOIN archive_bills bill ON bill.id=file.historical_bill_id WHERE file.source_artifact_id IS NOT NULL),
    'postingEffect',JSONB_BUILD_OBJECT('stockQuantity',0,'payablePaise',0,'gstPaise',0,'journalPaise',0,
      'verifiedArchiveOnly',(SELECT COALESCE(BOOL_AND((before_snapshot->>'archiveOnly')::BOOLEAN),TRUE) FROM source WHERE action='created')),
    'matched',(SELECT COUNT(*) FROM source WHERE action='created')=(SELECT COUNT(*) FROM archive_lines)
      AND (SELECT COUNT(DISTINCT CONCAT_WS('|',job_id,source_external_id)) FROM source WHERE action='created')=(SELECT COUNT(*) FROM archive_bills)
  ) INTO v_historical;

  SELECT JSONB_BUILD_OBJECT(
    'declaredSnapshot',COALESCE(SUM(line.quantity::BIGINT),0),
    'stockBefore',COALESCE(SUM(COALESCE((result.before_snapshot#>>'{locationStock,quantity}')::BIGINT,0)),0),
    'appliedDelta',COALESCE(SUM(line.applied_delta::BIGINT),0),
    'stockAfter',COALESCE(SUM(stock.quantity::BIGINT),0),
    'postCutoverMovements',COALESCE(SUM(line.post_cutover_delta::BIGINT),0),
    'expectedCurrentStock',COALESCE(SUM(line.expected_quantity::BIGINT),0),
    'batchDeclaredTotal',COALESCE(SUM((SELECT COALESCE(SUM((batch->>'quantity')::BIGINT),0)
      FROM JSONB_ARRAY_ELEMENTS(line.batches_json) batch)),0),
    'locationTotal',COALESCE(SUM(stock.quantity::BIGINT),0),
    'openingValuationPaise',COALESCE(SUM(line.valuation_paise),0),
    'matched',COALESCE(BOOL_AND(line.expected_quantity=stock.quantity
      AND line.valuation_paise::NUMERIC=line.quantity::NUMERIC*line.unit_cost_paise::NUMERIC),FALSE)
  ) INTO v_inventory
  FROM integration_opening_inventory_snapshot_lines line
  JOIN integration_opening_inventory_snapshots snapshot ON snapshot.id=line.snapshot_id
  LEFT JOIN inventory_location_stock stock ON stock.tenant_id=line.tenant_id AND stock.branch_id=line.branch_id
    AND stock.inventory_item_id=line.inventory_item_id AND stock.location_code=line.location_code
  LEFT JOIN integration_import_row_results result ON result.job_id=snapshot.import_job_id
    AND result.source_row_number=line.source_row_number AND result.source_sheet=line.source_sheet
  WHERE snapshot.tenant_id=p_tenant AND snapshot.branch_id=p_branch AND snapshot.cutover_id=p_cutover;

  SELECT JSONB_BUILD_OBJECT(
    'historicalPostingEffectPaise',0,
    'openingPayableSourcePaise',COALESCE((SELECT SUM(source_outstanding_total_paise) FROM supplier_opening_payable_imports
      WHERE tenant_id=p_tenant AND branch_id=p_branch AND cutover_id=p_cutover AND rolled_back_at IS NULL),0),
    'openingPayableAppliedPaise',COALESCE((SELECT SUM(CASE line.balance_side WHEN 'credit' THEN line.amount_paise ELSE -line.amount_paise END)
      FROM supplier_opening_payables line JOIN supplier_opening_payable_imports opening ON opening.id=line.opening_import_id
      WHERE opening.tenant_id=p_tenant AND opening.branch_id=p_branch AND opening.cutover_id=p_cutover AND opening.rolled_back_at IS NULL),0),
    'openingInventoryJournalPaise',COALESCE((SELECT SUM(opening_valuation_paise) FROM integration_opening_inventory_accounting
      WHERE tenant_id=p_tenant AND branch_id=p_branch AND cutover_id=p_cutover AND rolled_back_at IS NULL),0),
    'gstEffectPaise',COALESCE((SELECT SUM(line.gst_paise) FROM supplier_opening_payables line
      JOIN supplier_opening_payable_imports opening ON opening.id=line.opening_import_id
      WHERE opening.tenant_id=p_tenant AND opening.branch_id=p_branch AND opening.cutover_id=p_cutover AND opening.rolled_back_at IS NULL),0),
    'supplierAllocationPaise',COALESCE((SELECT SUM(allocation.amount_paise) FROM supplier_opening_payable_allocations allocation
      JOIN supplier_opening_payables line ON line.id=allocation.opening_payable_id
      JOIN supplier_opening_payable_imports opening ON opening.id=line.opening_import_id
      WHERE opening.tenant_id=p_tenant AND opening.branch_id=p_branch AND opening.cutover_id=p_cutover AND opening.rolled_back_at IS NULL),0)
  ) INTO v_accounting;

  RETURN JSONB_BUILD_OBJECT('status',CASE WHEN JSONB_ARRAY_LENGTH(v_blockers)=0 THEN 'matched' ELSE 'blocked' END,
    'historical',v_historical,'inventory',v_inventory,'accounting',v_accounting,'blockers',v_blockers);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION reject_integration_migration_cutover_mutation()
RETURNS TRIGGER AS $$
DECLARE
  v_actor TEXT;
  v_role TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_DELETE_FORBIDDEN'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.cutover_date IS DISTINCT FROM OLD.cutover_date
     OR NEW.contract_version IS DISTINCT FROM OLD.contract_version OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_actor := NULLIF(CURRENT_SETTING('aurashine.cutover_actor_id', TRUE), '');
    v_role := LOWER(NULLIF(CURRENT_SETTING('aurashine.cutover_actor_role', TRUE), ''));
    IF v_actor IS NULL OR v_role IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_ACTOR_REQUIRED'; END IF;
    IF NOT ((OLD.status='draft' AND NEW.status='history_importing') OR
      (OLD.status='history_importing' AND NEW.status='inventory_frozen') OR
      (OLD.status='inventory_frozen' AND NEW.status='snapshot_approved') OR
      (OLD.status='snapshot_approved' AND NEW.status='snapshot_applied') OR
      (OLD.status='snapshot_applied' AND NEW.status='reconciled') OR
      (OLD.status='reconciled' AND NEW.status='live')) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_TRANSITION_INVALID';
    END IF;
    IF NEW.status IN ('inventory_frozen','live') AND v_role NOT IN ('owner','superadmin','super-admin') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_OWNER_APPROVAL_REQUIRED';
    END IF;
    IF NEW.status='live' AND JSONB_ARRAY_LENGTH(migration_cutover_full_reconciliation(
      NEW.tenant_id::TEXT,NEW.branch_id::TEXT,NEW.id)->'blockers')>0 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_RECONCILIATION_BLOCKED';
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
