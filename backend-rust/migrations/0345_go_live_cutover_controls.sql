ALTER TABLE integration_migration_cutovers
  ADD COLUMN IF NOT EXISTS go_live_approved_role TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS go_live_approval_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS go_live_reconciliation_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS go_live_reconciliation_checksum TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS go_live_reconciliation JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS rollback_policy_json JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE integration_migration_cutovers
  ADD CONSTRAINT integration_migration_cutover_go_live_approval_check CHECK (
    status<>'live' OR (
      go_live_approved_role<>''
      AND go_live_approval_note<>''
      AND go_live_reconciliation_version='2026-07-phase7-v1'
      AND go_live_reconciliation_checksum ~ '^[0-9a-f]{64}$'
      AND JSONB_TYPEOF(go_live_reconciliation)='object'
      AND go_live_reconciliation->>'status'='matched'
      AND JSONB_TYPEOF(rollback_policy_json)='object'
      AND (rollback_policy_json->>'observationPeriodHours')::INTEGER BETWEEN 24 AND 72
    )
  ) NOT VALID;

ALTER FUNCTION migration_cutover_full_reconciliation(TEXT,TEXT,TEXT)
  RENAME TO migration_cutover_full_reconciliation_phase6;

CREATE FUNCTION migration_cutover_full_reconciliation(
  p_tenant TEXT,
  p_branch TEXT,
  p_cutover TEXT
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_blockers JSONB;
  v_finalization JSONB;
BEGIN
  v_result:=migration_cutover_full_reconciliation_phase6(p_tenant,p_branch,p_cutover);

  WITH scoped_jobs AS (
    SELECT job.* FROM integration_import_jobs job
    WHERE job.tenant_id=p_tenant AND job.branch_id=p_branch
      AND job.analysis_json->'postingContract'->>'cutoverId'=p_cutover
  ), extra_blockers AS (
    SELECT 'MISSING_HISTORICAL_BILL_EVIDENCE' code WHERE NOT EXISTS(
      SELECT 1 FROM historical_purchase_evidence_items evidence
      WHERE evidence.tenant_id=p_tenant AND evidence.branch_id=p_branch
        AND evidence.cutover_id=p_cutover AND evidence.evidence_kind='historical_bill'
    )
    UNION ALL SELECT 'MISSING_PHYSICAL_INVENTORY_EVIDENCE' WHERE NOT EXISTS(
      SELECT 1 FROM historical_purchase_evidence_items evidence
      WHERE evidence.tenant_id=p_tenant AND evidence.branch_id=p_branch
        AND evidence.cutover_id=p_cutover AND evidence.evidence_kind='physical_inventory'
    )
    UNION ALL SELECT 'MISSING_SUPPLIER_OUTSTANDING_EVIDENCE' WHERE NOT EXISTS(
      SELECT 1 FROM historical_purchase_evidence_items evidence
      WHERE evidence.tenant_id=p_tenant AND evidence.branch_id=p_branch
        AND evidence.cutover_id=p_cutover AND evidence.evidence_kind='supplier_outstanding'
    )
    UNION ALL SELECT 'UNVERIFIED_REQUIRED_EVIDENCE' WHERE EXISTS(
      SELECT 1 FROM historical_purchase_evidence_items evidence
      JOIN integration_import_source_files source ON source.tenant_id=evidence.tenant_id
        AND source.branch_id=evidence.branch_id AND source.id=evidence.source_file_id
      WHERE evidence.tenant_id=p_tenant AND evidence.branch_id=p_branch
        AND evidence.cutover_id=p_cutover
        AND (source.evidence_status<>'verified' OR source.sha256 !~ '^[0-9a-f]{64}$')
    )
    UNION ALL SELECT 'MISSING_REQUIRED_BILL_EVIDENCE' WHERE EXISTS(
      SELECT 1 FROM historical_purchase_archive_items item
      JOIN historical_purchase_archive_batches batch ON batch.job_id=item.job_id
      WHERE batch.tenant_id=p_tenant AND batch.branch_id=p_branch AND batch.cutover_id=p_cutover
        AND NOT EXISTS(
          SELECT 1 FROM historical_purchase_evidence_items evidence
          WHERE evidence.tenant_id=item.tenant_id AND evidence.branch_id=item.branch_id
            AND evidence.cutover_id=batch.cutover_id AND evidence.source_file_id=item.source_file_id
            AND evidence.evidence_kind='historical_bill'
        )
    )
    UNION ALL SELECT 'HISTORICAL_BILL_FINAL_STATE_INCOMPLETE' WHERE EXISTS(
      SELECT 1 FROM historical_purchase_archive_items item
      JOIN historical_purchase_archive_batches batch ON batch.job_id=item.job_id
      WHERE batch.tenant_id=p_tenant AND batch.branch_id=p_branch AND batch.cutover_id=p_cutover
        AND item.status NOT IN ('archived','duplicate','quarantined','rejected','cancelled')
    )
    UNION ALL SELECT 'QUARANTINE_ACKNOWLEDGEMENT_INCOMPLETE' WHERE EXISTS(
      SELECT 1 FROM historical_purchase_archive_items item
      JOIN historical_purchase_archive_batches batch ON batch.job_id=item.job_id
      JOIN purchase_bill_drafts draft ON draft.id=item.draft_id
      WHERE batch.tenant_id=p_tenant AND batch.branch_id=p_branch AND batch.cutover_id=p_cutover
        AND item.status IN ('quarantined','rejected','cancelled')
        AND BTRIM(COALESCE(item.error_message,''))=''
        AND BTRIM(COALESCE(draft.review_reason,''))=''
    )
    UNION ALL SELECT 'HISTORICAL_ARCHIVE_COUNT_MISMATCH' WHERE EXISTS(
      SELECT 1 FROM historical_purchase_archive_batches batch
      WHERE batch.tenant_id=p_tenant AND batch.branch_id=p_branch AND batch.cutover_id=p_cutover
        AND batch.expected_bill_count<>(SELECT COUNT(*) FROM historical_purchase_archive_items item WHERE item.job_id=batch.job_id)
    )
    UNION ALL SELECT 'HISTORICAL_ARCHIVE_TOTAL_MISMATCH' WHERE EXISTS(
      SELECT 1 FROM historical_purchase_archive_batches batch
      WHERE batch.tenant_id=p_tenant AND batch.branch_id=p_branch AND batch.cutover_id=p_cutover
        AND batch.expected_total_paise IS NOT NULL
        AND batch.expected_total_paise<>(SELECT COALESCE(SUM(item.source_total_paise),0)::BIGINT FROM historical_purchase_archive_items item WHERE item.job_id=batch.job_id)
    )
    UNION ALL SELECT 'HISTORICAL_TAX_TOTAL_MISMATCH' WHERE
      COALESCE((v_result#>>'{historical,sourceTotals,taxablePaise}')::BIGINT,0)
        <>COALESCE((v_result#>>'{historical,archiveTotals,taxablePaise}')::BIGINT,0)
      OR COALESCE((v_result#>>'{historical,sourceTotals,cgstPaise}')::BIGINT,0)
        <>COALESCE((v_result#>>'{historical,archiveTotals,cgstPaise}')::BIGINT,0)
      OR COALESCE((v_result#>>'{historical,sourceTotals,sgstPaise}')::BIGINT,0)
        <>COALESCE((v_result#>>'{historical,archiveTotals,sgstPaise}')::BIGINT,0)
      OR COALESCE((v_result#>>'{historical,sourceTotals,igstPaise}')::BIGINT,0)
        <>COALESCE((v_result#>>'{historical,archiveTotals,igstPaise}')::BIGINT,0)
    UNION ALL SELECT 'WORKER_OR_CHUNK_STILL_PROCESSING' WHERE EXISTS(
      SELECT 1 FROM scoped_jobs job WHERE job.status IN ('staging','dependency_pending','queued','processing')
      UNION ALL
      SELECT 1 FROM integration_import_chunks chunk JOIN scoped_jobs job ON job.id=chunk.job_id
      WHERE chunk.status IN ('staged','pending','processing')
    )
    UNION ALL SELECT 'OPENING_PAYABLE_SOURCE_NOT_RECONCILED' WHERE
      EXISTS(SELECT 1 FROM historical_purchase_evidence_items evidence
        WHERE evidence.tenant_id=p_tenant AND evidence.branch_id=p_branch
          AND evidence.cutover_id=p_cutover AND evidence.evidence_kind='supplier_outstanding')
      AND NOT EXISTS(SELECT 1 FROM scoped_jobs job
        WHERE job.entity='opening-payables' AND job.status='completed' AND job.rolled_back_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM supplier_opening_payable_imports opening
        WHERE opening.tenant_id=p_tenant AND opening.branch_id=p_branch
          AND opening.cutover_id=p_cutover AND opening.rolled_back_at IS NULL)
    UNION ALL SELECT 'OPENING_PAYABLE_JOURNAL_IMBALANCE' WHERE EXISTS(
      SELECT 1 FROM supplier_opening_payable_imports opening
      WHERE opening.tenant_id=p_tenant AND opening.branch_id=p_branch
        AND opening.cutover_id=p_cutover AND opening.rolled_back_at IS NULL
        AND NOT EXISTS(
          SELECT 1 FROM accounting_journal_lines line
          WHERE line.journal_entry_id=opening.journal_entry_id
          HAVING SUM(line.debit_paise)=SUM(line.credit_paise) AND SUM(line.debit_paise)>0
        )
    )
    UNION ALL SELECT 'OPENING_INVENTORY_JOURNAL_IMBALANCE' WHERE EXISTS(
      SELECT 1 FROM integration_opening_inventory_accounting accounting
      WHERE accounting.tenant_id=p_tenant AND accounting.branch_id=p_branch
        AND accounting.cutover_id=p_cutover AND accounting.rolled_back_at IS NULL
        AND accounting.opening_valuation_paise<>0
        AND NOT EXISTS(
          SELECT 1 FROM accounting_journal_lines line
          WHERE line.journal_entry_id=accounting.journal_entry_id
          HAVING SUM(line.debit_paise)=SUM(line.credit_paise) AND SUM(line.debit_paise)>0
        )
    )
    UNION ALL SELECT 'DUPLICATE_OPENING_STOCK_MOVEMENT' WHERE EXISTS(
      SELECT ledger.opening_snapshot_line_id FROM inventory_stock_ledger ledger
      JOIN integration_opening_inventory_snapshots snapshot ON snapshot.id=ledger.opening_snapshot_id
      WHERE snapshot.tenant_id=p_tenant AND snapshot.branch_id=p_branch AND snapshot.cutover_id=p_cutover
        AND ledger.movement_type='opening_snapshot'
      GROUP BY ledger.opening_snapshot_line_id HAVING COUNT(*)<>1
    )
    UNION ALL SELECT 'NEGATIVE_CURRENT_STOCK' WHERE EXISTS(
      SELECT 1 FROM integration_opening_inventory_snapshot_lines line
      JOIN integration_opening_inventory_snapshots snapshot ON snapshot.id=line.snapshot_id
      JOIN inventory_location_stock stock ON stock.tenant_id=line.tenant_id AND stock.branch_id=line.branch_id
        AND stock.inventory_item_id=line.inventory_item_id AND stock.location_code=line.location_code
      WHERE snapshot.tenant_id=p_tenant AND snapshot.branch_id=p_branch
        AND snapshot.cutover_id=p_cutover AND stock.quantity<0
    )
  )
  SELECT COALESCE(JSONB_AGG(DISTINCT code ORDER BY code),'[]'::JSONB) INTO v_blockers
  FROM (
    SELECT JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(v_result->'blockers','[]'::JSONB)) code
    UNION ALL SELECT code FROM extra_blockers
  ) all_blockers;

  SELECT JSONB_BUILD_OBJECT(
    'evidenceFiles',(SELECT COUNT(*) FROM historical_purchase_evidence_items evidence
      WHERE evidence.tenant_id=p_tenant AND evidence.branch_id=p_branch AND evidence.cutover_id=p_cutover),
    'archiveItems',(SELECT COUNT(*) FROM historical_purchase_archive_items item
      JOIN historical_purchase_archive_batches batch ON batch.job_id=item.job_id
      WHERE batch.tenant_id=p_tenant AND batch.branch_id=p_branch AND batch.cutover_id=p_cutover),
    'finalArchiveItems',(SELECT COUNT(*) FROM historical_purchase_archive_items item
      JOIN historical_purchase_archive_batches batch ON batch.job_id=item.job_id
      WHERE batch.tenant_id=p_tenant AND batch.branch_id=p_branch AND batch.cutover_id=p_cutover
        AND item.status IN ('archived','duplicate','quarantined','rejected','cancelled')),
    'activeJobs',(SELECT COUNT(*) FROM integration_import_jobs job
      WHERE job.tenant_id=p_tenant AND job.branch_id=p_branch
        AND job.analysis_json->'postingContract'->>'cutoverId'=p_cutover
        AND job.status IN ('staging','dependency_pending','queued','processing')),
    'reconciliationVersion','2026-07-phase7-v1'
  ) INTO v_finalization;

  v_result:=JSONB_SET(v_result,'{blockers}',v_blockers);
  v_result:=JSONB_SET(v_result,'{finalization}',v_finalization);
  RETURN JSONB_SET(v_result,'{status}',TO_JSONB(CASE WHEN JSONB_ARRAY_LENGTH(v_blockers)=0 THEN 'matched' ELSE 'blocked' END));
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION assert_cutover_allows_live_operation(
  p_tenant TEXT,
  p_branch TEXT
) RETURNS VOID AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM integration_migration_cutovers cutover
    WHERE cutover.tenant_id::TEXT=p_tenant AND cutover.branch_id::TEXT=p_branch
      AND cutover.status IN ('inventory_frozen','snapshot_approved','snapshot_applied','reconciled')
      AND cutover.rollback_state<>'completed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_OPERATION_FROZEN';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_cutover_scoped_live_operation()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM assert_cutover_allows_live_operation(NEW.tenant_id,NEW.branch_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pos_sales_cutover_guard ON pos_sales;
CREATE TRIGGER trg_pos_sales_cutover_guard
BEFORE INSERT ON pos_sales
FOR EACH ROW EXECUTE FUNCTION guard_cutover_scoped_live_operation();

DROP TRIGGER IF EXISTS trg_purchase_receipts_cutover_guard ON purchase_receipts;
CREATE TRIGGER trg_purchase_receipts_cutover_guard
BEFORE INSERT ON purchase_receipts
FOR EACH ROW EXECUTE FUNCTION guard_cutover_scoped_live_operation();

DROP TRIGGER IF EXISTS trg_supplier_payments_cutover_guard ON supplier_payments;
CREATE TRIGGER trg_supplier_payments_cutover_guard
BEFORE INSERT ON supplier_payments
FOR EACH ROW EXECUTE FUNCTION guard_cutover_scoped_live_operation();

CREATE OR REPLACE FUNCTION guard_inventory_transfer_cutover()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM assert_cutover_allows_live_operation(NEW.tenant_id,NEW.source_branch_id);
  PERFORM assert_cutover_allows_live_operation(NEW.tenant_id,NEW.destination_branch_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_transfers_cutover_guard ON inventory_transfers;
CREATE TRIGGER trg_inventory_transfers_cutover_guard
BEFORE INSERT OR UPDATE OF status ON inventory_transfers
FOR EACH ROW EXECUTE FUNCTION guard_inventory_transfer_cutover();

CREATE OR REPLACE FUNCTION reject_integration_migration_cutover_mutation()
RETURNS TRIGGER AS $$
DECLARE
  v_actor TEXT;
  v_role TEXT;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_DELETE_FORBIDDEN';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.cutover_date IS DISTINCT FROM OLD.cutover_date
     OR NEW.contract_version IS DISTINCT FROM OLD.contract_version OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.status='live' AND (
       NEW.go_live_at IS DISTINCT FROM OLD.go_live_at
       OR NEW.inventory_freeze_end IS DISTINCT FROM OLD.inventory_freeze_end
       OR NEW.owner_approved_by IS DISTINCT FROM OLD.owner_approved_by
       OR NEW.owner_approved_at IS DISTINCT FROM OLD.owner_approved_at
       OR NEW.go_live_approved_role IS DISTINCT FROM OLD.go_live_approved_role
       OR NEW.go_live_approval_note IS DISTINCT FROM OLD.go_live_approval_note
       OR NEW.go_live_reconciliation_version IS DISTINCT FROM OLD.go_live_reconciliation_version
       OR NEW.go_live_reconciliation_checksum IS DISTINCT FROM OLD.go_live_reconciliation_checksum
       OR NEW.go_live_reconciliation IS DISTINCT FROM OLD.go_live_reconciliation
       OR NEW.rollback_policy_json IS DISTINCT FROM OLD.rollback_policy_json
     ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_GO_LIVE_AUDIT_IMMUTABLE';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_actor:=NULLIF(CURRENT_SETTING('aurashine.cutover_actor_id',TRUE),'');
    v_role:=LOWER(NULLIF(CURRENT_SETTING('aurashine.cutover_actor_role',TRUE),''));
    IF v_actor IS NULL OR v_role IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_ACTOR_REQUIRED';
    END IF;
    IF NOT ((OLD.status='draft' AND NEW.status='history_importing')
      OR (OLD.status='history_importing' AND NEW.status='inventory_frozen')
      OR (OLD.status='inventory_frozen' AND NEW.status='snapshot_approved')
      OR (OLD.status='snapshot_approved' AND NEW.status='snapshot_applied')
      OR (OLD.status='snapshot_applied' AND NEW.status='reconciled')
      OR (OLD.status='reconciled' AND NEW.status='live')) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_TRANSITION_INVALID';
    END IF;
    IF NEW.status IN ('inventory_frozen','snapshot_approved','live')
       AND v_role NOT IN ('owner','superadmin','super-admin') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_OWNER_APPROVAL_REQUIRED';
    END IF;
    IF NEW.status='live' THEN
      IF BTRIM(NEW.go_live_approval_note)='' OR NEW.go_live_approved_role<>v_role
         OR NEW.go_live_reconciliation_version<>'2026-07-phase7-v1'
         OR NEW.go_live_reconciliation_checksum !~ '^[0-9a-f]{64}$'
         OR NEW.go_live_reconciliation->>'status'<>'matched' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_GO_LIVE_APPROVAL_PACK_REQUIRED';
      END IF;
      IF JSONB_ARRAY_LENGTH(migration_cutover_full_reconciliation(
        NEW.tenant_id::TEXT,NEW.branch_id::TEXT,NEW.id)->'blockers')>0 THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_RECONCILIATION_BLOCKED';
      END IF;
    END IF;
  END IF;
  NEW.updated_at:=NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
