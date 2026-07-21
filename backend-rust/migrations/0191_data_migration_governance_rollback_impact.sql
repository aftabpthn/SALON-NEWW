-- Import-owned purchase receipt lines and stock ledger entries are removed explicitly by
-- the rollback transaction. Count them as managed impact, not external blockers.
CREATE OR REPLACE FUNCTION migration_import_dependency_impact(
  p_tenant_id TEXT,
  p_branch_id TEXT,
  p_job_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_entity TEXT;
  v_target_table TEXT;
  v_target_ids TEXT[];
  v_fk RECORD;
  v_count BIGINT;
  v_scope TEXT;
  v_blocking BIGINT := 0;
  v_cascade BIGINT := 0;
  v_set_null BIGINT := 0;
  v_managed BIGINT := 0;
  v_tables JSONB := '{}'::JSONB;
BEGIN
  SELECT entity INTO v_entity
  FROM integration_import_jobs
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id AND id = p_job_id;

  v_target_table := CASE v_entity
    WHEN 'clients' THEN 'clients'
    WHEN 'staff' THEN 'staff'
    WHEN 'services' THEN 'services'
    WHEN 'products' THEN 'inventory_items'
    WHEN 'inventory' THEN 'inventory_items'
    WHEN 'suppliers' THEN 'suppliers'
    WHEN 'memberships' THEN 'memberships'
    WHEN 'packages' THEN 'packages'
    WHEN 'appointments' THEN 'appointments'
    WHEN 'sales' THEN 'pos_sales'
    WHEN 'invoices' THEN 'pos_sales'
    WHEN 'payments' THEN 'pos_payments'
    WHEN 'expenses' THEN 'outgoing_fund_vouchers'
    WHEN 'purchase-bills' THEN 'purchase_receipts'
    ELSE NULL
  END;

  IF v_target_table IS NULL OR to_regclass(v_target_table) IS NULL THEN
    RETURN jsonb_build_object('blockingRecords', 0, 'cascadeRecords', 0, 'setNullRecords', 0, 'managedRecords', 0, 'byTable', '{}'::JSONB);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT target_id), ARRAY[]::TEXT[])
  INTO v_target_ids
  FROM integration_import_row_results
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id AND job_id = p_job_id
    AND action = 'created' AND target_id IS NOT NULL;

  IF cardinality(v_target_ids) = 0 THEN
    RETURN jsonb_build_object('blockingRecords', 0, 'cascadeRecords', 0, 'setNullRecords', 0, 'managedRecords', 0, 'byTable', '{}'::JSONB);
  END IF;

  FOR v_fk IN
    SELECT c.conrelid::regclass::TEXT AS table_name,
           child_col.attname AS column_name,
           c.confdeltype
    FROM pg_constraint c
    JOIN pg_attribute child_col
      ON child_col.attrelid = c.conrelid AND child_col.attnum = c.conkey[1]
    JOIN pg_attribute parent_col
      ON parent_col.attrelid = c.confrelid AND parent_col.attnum = c.confkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = to_regclass(v_target_table)
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND parent_col.attname = 'id'
  LOOP
    v_scope := '';
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(v_fk.table_name) AND attname = 'tenant_id' AND NOT attisdropped) THEN
      v_scope := v_scope || ' AND tenant_id = $2';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(v_fk.table_name) AND attname = 'branch_id' AND NOT attisdropped) THEN
      v_scope := v_scope || ' AND branch_id = $3';
    END IF;
    EXECUTE format('SELECT COUNT(*) FROM %s WHERE %I = ANY($1)%s', v_fk.table_name, v_fk.column_name, v_scope)
      INTO v_count USING v_target_ids, p_tenant_id, p_branch_id;
    IF v_count = 0 THEN
      CONTINUE;
    END IF;
    v_tables := v_tables || jsonb_build_object(v_fk.table_name, COALESCE((v_tables ->> v_fk.table_name)::BIGINT, 0) + v_count);
    IF v_entity = 'purchase-bills' AND v_fk.table_name IN ('purchase_receipt_lines', 'inventory_stock_ledger') THEN
      v_managed := v_managed + v_count;
    ELSIF v_fk.confdeltype = 'c' THEN
      v_cascade := v_cascade + v_count;
    ELSIF v_fk.confdeltype IN ('n', 'd') THEN
      v_set_null := v_set_null + v_count;
    ELSE
      v_blocking := v_blocking + v_count;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'blockingRecords', v_blocking,
    'cascadeRecords', v_cascade,
    'setNullRecords', v_set_null,
    'managedRecords', v_managed,
    'byTable', v_tables
  );
END;
$$;
