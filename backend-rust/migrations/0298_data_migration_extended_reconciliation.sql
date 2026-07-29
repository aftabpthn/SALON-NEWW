ALTER FUNCTION migration_import_financial_reconciliation(TEXT,TEXT,TEXT)
  RENAME TO migration_import_financial_reconciliation_legacy;

CREATE OR REPLACE FUNCTION migration_import_financial_reconciliation(
  p_tenant_id TEXT,
  p_branch_id TEXT,
  p_job_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_entity TEXT;
  v_status TEXT;
  v_primary_label TEXT;
  v_secondary_label TEXT;
  v_source_primary BIGINT := 0;
  v_source_secondary BIGINT := 0;
  v_target_primary BIGINT := 0;
  v_target_secondary BIGINT := 0;
  v_matched BOOLEAN;
BEGIN
  SELECT entity,status INTO v_entity,v_status
  FROM integration_import_jobs
  WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND id=p_job_id;

  IF v_entity NOT IN ('refunds','gift-cards','loyalty','payroll','commissions','stock-movements') THEN
    RETURN migration_import_financial_reconciliation_legacy(p_tenant_id,p_branch_id,p_job_id);
  END IF;

  IF v_entity='refunds' THEN
    v_primary_label := 'amountPaise';
    SELECT COALESCE(SUM((source_payload->>'amount_paise')::BIGINT),0)
      INTO v_source_primary FROM integration_import_row_results
     WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(record.amount_paise),0) INTO v_target_primary
      FROM pos_invoice_refunds record JOIN integration_import_row_results result ON result.job_id=p_job_id AND result.target_id=record.id
     WHERE record.tenant_id=p_tenant_id AND record.branch_id=p_branch_id AND result.action<>'';
  ELSIF v_entity='gift-cards' THEN
    v_primary_label := 'initialAmountPaise'; v_secondary_label := 'balancePaise';
    SELECT COALESCE(SUM((source_payload->>'initial_amount_paise')::BIGINT),0),COALESCE(SUM((source_payload->>'balance_paise')::BIGINT),0)
      INTO v_source_primary,v_source_secondary FROM integration_import_row_results
     WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(record.initial_amount_paise),0),COALESCE(SUM(record.balance_paise),0)
      INTO v_target_primary,v_target_secondary
      FROM gift_cards record JOIN integration_import_row_results result ON result.job_id=p_job_id AND result.target_id=record.id
     WHERE record.tenant_id=p_tenant_id AND record.branch_id=p_branch_id AND result.action<>'';
  ELSIF v_entity='loyalty' THEN
    v_primary_label := 'points'; v_secondary_label := 'balanceAfter';
    SELECT COALESCE(SUM((source_payload->>'points')::BIGINT),0),COALESCE(SUM((source_payload->>'balance_after')::BIGINT),0)
      INTO v_source_primary,v_source_secondary FROM integration_import_row_results
     WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(record.points),0),COALESCE(SUM(record.balance_after),0)
      INTO v_target_primary,v_target_secondary
      FROM membership_reward_ledger record JOIN integration_import_row_results result ON result.job_id=p_job_id AND result.target_id=record.id
     WHERE record.tenant_id=p_tenant_id AND record.branch_id=p_branch_id AND result.action<>'';
  ELSIF v_entity='payroll' THEN
    v_primary_label := 'grossPaise'; v_secondary_label := 'netPaise';
    SELECT COALESCE(SUM((source_payload->>'gross_paise')::BIGINT),0),COALESCE(SUM((source_payload->>'net_paise')::BIGINT),0)
      INTO v_source_primary,v_source_secondary FROM integration_import_row_results
     WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(record.gross_paise),0),COALESCE(SUM(record.net_paise),0)
      INTO v_target_primary,v_target_secondary
      FROM staff_payroll_items record JOIN integration_import_row_results result ON result.job_id=p_job_id AND result.target_id=record.id
     WHERE record.tenant_id=p_tenant_id AND record.branch_id=p_branch_id AND result.action<>'';
  ELSIF v_entity='commissions' THEN
    v_primary_label := 'basePaise'; v_secondary_label := 'commissionPaise';
    SELECT COALESCE(SUM((source_payload->>'base_paise')::BIGINT),0),COALESCE(SUM((source_payload->>'commission_paise')::BIGINT),0)
      INTO v_source_primary,v_source_secondary FROM integration_import_row_results
     WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(record.base_paise),0),COALESCE(SUM(record.commission_paise),0)
      INTO v_target_primary,v_target_secondary
      FROM pos_staff_commission_snapshots record JOIN integration_import_row_results result ON result.job_id=p_job_id AND result.target_id=record.id
     WHERE record.tenant_id=p_tenant_id AND record.branch_id=p_branch_id AND result.action<>'';
  ELSE
    v_primary_label := 'quantityDelta';
    SELECT COALESCE(SUM((source_payload->>'quantity_delta')::BIGINT),0)
      INTO v_source_primary FROM integration_import_row_results
     WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(record.quantity_delta),0) INTO v_target_primary
      FROM inventory_stock_ledger record JOIN integration_import_row_results result ON result.job_id=p_job_id AND result.target_id=record.id
     WHERE record.tenant_id=p_tenant_id AND record.branch_id=p_branch_id AND result.action<>'';
  END IF;

  v_matched := v_source_primary=v_target_primary AND (v_secondary_label IS NULL OR v_source_secondary=v_target_secondary);
  RETURN jsonb_build_object(
    'supported',TRUE,
    'status',CASE WHEN v_status='rolled_back' THEN 'rolled_back' WHEN v_status<>'completed' THEN 'pending' WHEN v_matched THEN 'matched' ELSE 'mismatch' END,
    'matched',v_matched,
    'metrics',jsonb_build_object(v_primary_label,jsonb_build_object('sourceValue',v_source_primary,'targetValue',v_target_primary,'difference',v_target_primary-v_source_primary))
      || CASE WHEN v_secondary_label IS NULL THEN '{}'::JSONB ELSE jsonb_build_object(v_secondary_label,jsonb_build_object('sourceValue',v_source_secondary,'targetValue',v_target_secondary,'difference',v_target_secondary-v_source_secondary)) END
  );
END;
$$;
