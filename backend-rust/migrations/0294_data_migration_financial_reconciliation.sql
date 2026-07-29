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
  v_job_status TEXT;
  v_primary_label TEXT;
  v_secondary_label TEXT;
  v_source_primary BIGINT := 0;
  v_source_secondary BIGINT := 0;
  v_target_primary BIGINT := 0;
  v_target_secondary BIGINT := 0;
  v_matched BOOLEAN;
BEGIN
  SELECT entity,status INTO v_entity,v_job_status
  FROM integration_import_jobs
  WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND id=p_job_id;

  IF v_entity IS NULL THEN
    RETURN jsonb_build_object('supported',FALSE,'status','not_found','metrics','[]'::JSONB);
  END IF;

  IF v_entity IN ('sales','invoices') THEN
    v_primary_label := 'totalPaise';
    v_secondary_label := 'taxPaise';
    SELECT
      COALESCE(SUM(CASE WHEN COALESCE(source_payload->>'total_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'total_paise')::BIGINT ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN COALESCE(source_payload->>'tax_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'tax_paise')::BIGINT ELSE 0 END),0)
    INTO v_source_primary,v_source_secondary
    FROM integration_import_row_results
    WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(sale.total_paise),0),COALESCE(SUM(sale.tax_paise),0)
    INTO v_target_primary,v_target_secondary
    FROM pos_sales sale
    JOIN (SELECT DISTINCT target_id FROM integration_import_row_results WHERE job_id=p_job_id AND target_id IS NOT NULL AND action<>'') target ON target.target_id=sale.id
    WHERE sale.tenant_id=p_tenant_id AND sale.branch_id=p_branch_id;
  ELSIF v_entity='payments' THEN
    v_primary_label := 'amountPaise';
    SELECT COALESCE(SUM(CASE WHEN COALESCE(source_payload->>'amount_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'amount_paise')::BIGINT ELSE 0 END),0)
    INTO v_source_primary
    FROM integration_import_row_results
    WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(payment.amount_paise),0) INTO v_target_primary
    FROM pos_payments payment
    JOIN (SELECT DISTINCT target_id FROM integration_import_row_results WHERE job_id=p_job_id AND target_id IS NOT NULL AND action<>'') target ON target.target_id=payment.id
    WHERE payment.tenant_id=p_tenant_id AND payment.branch_id=p_branch_id;
  ELSIF v_entity='expenses' THEN
    v_primary_label := 'amountPaise';
    v_secondary_label := 'gstPaise';
    SELECT
      COALESCE(SUM(CASE WHEN COALESCE(source_payload->>'amount_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'amount_paise')::BIGINT ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN COALESCE(source_payload->>'gst_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'gst_paise')::BIGINT ELSE 0 END),0)
    INTO v_source_primary,v_source_secondary
    FROM integration_import_row_results
    WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(line.amount_paise),0),COALESCE(SUM(line.gst_paise),0)
    INTO v_target_primary,v_target_secondary
    FROM outgoing_fund_lines line
    JOIN (SELECT DISTINCT target_id FROM integration_import_row_results WHERE job_id=p_job_id AND target_id IS NOT NULL AND action<>'') target ON target.target_id=line.voucher_id
    WHERE line.tenant_id=p_tenant_id AND line.branch_id=p_branch_id;
  ELSIF v_entity='purchase-bills' THEN
    v_primary_label := 'totalPaise';
    v_secondary_label := 'taxPaise';
    SELECT
      COALESCE(SUM(CASE WHEN COALESCE(source_payload->>'total_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'total_paise')::BIGINT ELSE 0 END),0),
      COALESCE(SUM(
        CASE WHEN COALESCE(source_payload->>'cgst_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'cgst_paise')::BIGINT ELSE 0 END+
        CASE WHEN COALESCE(source_payload->>'sgst_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'sgst_paise')::BIGINT ELSE 0 END+
        CASE WHEN COALESCE(source_payload->>'igst_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'igst_paise')::BIGINT ELSE 0 END
      ),0)
    INTO v_source_primary,v_source_secondary
    FROM integration_import_row_results
    WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(receipt.total_paise),0),COALESCE(SUM(receipt.cgst_paise+receipt.sgst_paise+receipt.igst_paise),0)
    INTO v_target_primary,v_target_secondary
    FROM purchase_receipts receipt
    JOIN (SELECT DISTINCT target_id FROM integration_import_row_results WHERE job_id=p_job_id AND target_id IS NOT NULL AND action<>'') target ON target.target_id=receipt.id
    WHERE receipt.tenant_id=p_tenant_id AND receipt.branch_id=p_branch_id AND receipt.rolled_back_at IS NULL;
  ELSIF v_entity='client-memberships' THEN
    v_primary_label := 'pricePaidPaise';
    v_secondary_label := 'balancePaise';
    SELECT
      COALESCE(SUM(CASE WHEN COALESCE(source_payload->>'price_paid_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'price_paid_paise')::BIGINT ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN COALESCE(source_payload->>'balance_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'balance_paise')::BIGINT ELSE 0 END),0)
    INTO v_source_primary,v_source_secondary
    FROM integration_import_row_results
    WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    SELECT COALESCE(SUM(assignment.migration_price_paid_paise),0),COALESCE(SUM(assignment.migration_balance_paise),0)
    INTO v_target_primary,v_target_secondary
    FROM client_memberships assignment
    JOIN (SELECT DISTINCT target_id FROM integration_import_row_results WHERE job_id=p_job_id AND target_id IS NOT NULL AND action<>'') target ON target.target_id=assignment.id
    WHERE assignment.tenant_id=p_tenant_id AND assignment.branch_id=p_branch_id;
  ELSIF v_entity IN ('memberships','packages') THEN
    v_primary_label := 'pricePaise';
    SELECT COALESCE(SUM(CASE WHEN COALESCE(source_payload->>'price_paise','') ~ '^-?[0-9]+$' THEN (source_payload->>'price_paise')::BIGINT ELSE 0 END),0)
    INTO v_source_primary
    FROM integration_import_row_results
    WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id AND action<>'';
    IF v_entity='memberships' THEN
      SELECT COALESCE(SUM(membership.price_paise),0) INTO v_target_primary
      FROM memberships membership
      JOIN (SELECT DISTINCT target_id FROM integration_import_row_results WHERE job_id=p_job_id AND target_id IS NOT NULL AND action<>'') target ON target.target_id=membership.id
      WHERE membership.tenant_id=p_tenant_id AND membership.branch_id=p_branch_id;
    ELSE
      SELECT COALESCE(SUM(package.price_paise),0) INTO v_target_primary
      FROM packages package
      JOIN (SELECT DISTINCT target_id FROM integration_import_row_results WHERE job_id=p_job_id AND target_id IS NOT NULL AND action<>'') target ON target.target_id=package.id
      WHERE package.tenant_id=p_tenant_id AND package.branch_id=p_branch_id;
    END IF;
  ELSE
    RETURN jsonb_build_object('supported',FALSE,'status','not_applicable','metrics','[]'::JSONB);
  END IF;

  v_matched := v_source_primary=v_target_primary AND (v_secondary_label IS NULL OR v_source_secondary=v_target_secondary);
  RETURN jsonb_build_object(
    'supported',TRUE,
    'status',CASE WHEN v_job_status='rolled_back' THEN 'rolled_back' WHEN v_job_status<>'completed' THEN 'pending' WHEN v_matched THEN 'matched' ELSE 'mismatch' END,
    'matched',v_matched,
    'metrics',jsonb_build_object(
      v_primary_label,jsonb_build_object('sourcePaise',v_source_primary,'targetPaise',v_target_primary,'differencePaise',v_target_primary-v_source_primary)
    ) || CASE WHEN v_secondary_label IS NULL THEN '{}'::JSONB ELSE jsonb_build_object(
      v_secondary_label,jsonb_build_object('sourcePaise',v_source_secondary,'targetPaise',v_target_secondary,'differencePaise',v_target_secondary-v_source_secondary)
    ) END
  );
END;
$$;
