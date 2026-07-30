ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS migration_price_paid_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migration_balance_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migration_staff_id TEXT,
  ADD COLUMN IF NOT EXISTS migration_source_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS import_job_id TEXT;

ALTER TABLE integration_import_jobs
  DROP CONSTRAINT IF EXISTS integration_import_jobs_entity_check;
ALTER TABLE integration_import_jobs
  ADD CONSTRAINT integration_import_jobs_entity_check
  CHECK (entity IN (
    'clients','staff','services','products','suppliers','inventory','memberships','client-memberships','packages',
    'appointments','sales','invoices','payments','expenses','purchase-bills'
  ));

ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_entity_check;
ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_entity_check
  CHECK (entity IN (
    'clients','staff','services','products','suppliers','inventory','memberships','client-memberships','packages',
    'appointments','sales','invoices','payments','expenses','purchase-bills'
  ));

ALTER TABLE integration_import_mappings
  DROP CONSTRAINT IF EXISTS integration_import_mappings_entity_check;
ALTER TABLE integration_import_mappings
  ADD CONSTRAINT integration_import_mappings_entity_check
  CHECK (entity IN (
    'clients','staff','services','products','suppliers','inventory','memberships','client-memberships','packages',
    'appointments','sales','invoices','payments','expenses','purchase-bills'
  ));

ALTER TABLE client_memberships
  DROP CONSTRAINT IF EXISTS client_memberships_migration_amounts_non_negative;

ALTER TABLE client_memberships
  ADD CONSTRAINT client_memberships_migration_amounts_non_negative
  CHECK (migration_price_paid_paise >= 0 AND migration_balance_paise >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_memberships_migration_source
  ON client_memberships (tenant_id, branch_id, migration_source_id)
  WHERE migration_source_id <> '';

CREATE INDEX IF NOT EXISTS idx_client_memberships_import_job
  ON client_memberships (tenant_id, branch_id, import_job_id)
  WHERE import_job_id IS NOT NULL;

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
    WHEN 'client-memberships' THEN 'client_memberships'
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
    RETURN jsonb_build_object('blockingRecords',0,'cascadeRecords',0,'setNullRecords',0,'managedRecords',0,'byTable','{}'::JSONB);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT target_id), ARRAY[]::TEXT[])
  INTO v_target_ids
  FROM integration_import_row_results
  WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND job_id=p_job_id
    AND action='created' AND target_id IS NOT NULL;

  IF cardinality(v_target_ids)=0 THEN
    RETURN jsonb_build_object('blockingRecords',0,'cascadeRecords',0,'setNullRecords',0,'managedRecords',0,'byTable','{}'::JSONB);
  END IF;

  FOR v_fk IN
    SELECT c.conrelid::regclass::TEXT AS table_name, child.attname AS column_name, c.confdeltype
    FROM pg_constraint c
    JOIN pg_attribute child ON child.attrelid=c.conrelid AND child.attnum=c.conkey[1]
    JOIN pg_attribute parent ON parent.attrelid=c.confrelid AND parent.attnum=c.confkey[1]
    WHERE c.contype='f' AND c.confrelid=to_regclass(v_target_table)
      AND cardinality(c.conkey)=1 AND cardinality(c.confkey)=1 AND parent.attname='id'
  LOOP
    v_scope := '';
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(v_fk.table_name) AND attname='tenant_id' AND NOT attisdropped) THEN
      v_scope := v_scope || ' AND tenant_id = $2';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(v_fk.table_name) AND attname='branch_id' AND NOT attisdropped) THEN
      v_scope := v_scope || ' AND branch_id = $3';
    END IF;
    EXECUTE format('SELECT COUNT(*) FROM %s WHERE %I = ANY($1)%s',v_fk.table_name,v_fk.column_name,v_scope)
      INTO v_count USING v_target_ids,p_tenant_id,p_branch_id;
    IF v_count=0 THEN CONTINUE; END IF;
    v_tables := v_tables || jsonb_build_object(v_fk.table_name,COALESCE((v_tables->>v_fk.table_name)::BIGINT,0)+v_count);
    IF v_entity='purchase-bills' AND v_fk.table_name IN ('purchase_receipt_lines','inventory_stock_ledger') THEN
      v_managed := v_managed+v_count;
    ELSIF v_fk.confdeltype='c' THEN v_cascade := v_cascade+v_count;
    ELSIF v_fk.confdeltype IN ('n','d') THEN v_set_null := v_set_null+v_count;
    ELSE v_blocking := v_blocking+v_count;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('blockingRecords',v_blocking,'cascadeRecords',v_cascade,'setNullRecords',v_set_null,'managedRecords',v_managed,'byTable',v_tables);
END;
$$;
