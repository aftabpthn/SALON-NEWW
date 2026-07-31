-- Run inside a transaction after migration 0329; the fixture requires one real scoped user/product.
DO $phase$
DECLARE
  t UUID; b UUID; item TEXT; u TEXT;
  stock BIGINT; ledger BIGINT; receipts BIGINT; journals BIGINT; debits BIGINT; credits BIGINT;
BEGIN
  SELECT tenant_id::UUID,branch_id::UUID,id INTO t,b,item FROM inventory_items LIMIT 1;
  SELECT id INTO u FROM users ORDER BY created_at LIMIT 1;
  IF t IS NULL OR u IS NULL THEN RAISE EXCEPTION 'REAL_SCOPE_FIXTURE_REQUIRED'; END IF;
  SELECT COALESCE(SUM(stock_quantity),0) INTO stock FROM inventory_items WHERE tenant_id=t::TEXT AND branch_id=b::TEXT;
  SELECT COUNT(*) INTO ledger FROM inventory_stock_ledger WHERE tenant_id=t::TEXT AND branch_id=b::TEXT;
  SELECT COUNT(*) INTO receipts FROM purchase_receipts WHERE tenant_id=t::TEXT AND branch_id=b::TEXT;
  SELECT COUNT(*) INTO journals FROM accounting_journal_entries WHERE tenant_id=t::TEXT AND branch_id=b::TEXT;
  SELECT COALESCE(SUM(l.debit_paise),0),COALESCE(SUM(l.credit_paise),0) INTO debits,credits
    FROM accounting_journal_lines l JOIN accounting_journal_entries e ON e.id=l.journal_entry_id
    WHERE e.tenant_id=t::TEXT AND e.branch_id=b::TEXT;

  INSERT INTO integration_import_upload_sessions(id,tenant_id,branch_id,original_file_name,file_extension,expected_size_bytes,expected_sha256,total_parts,status,created_by)
    VALUES('p4-upload',t::TEXT,b::TEXT,'history.zip','zip',10,REPEAT('a',64),1,'completed',u);
  INSERT INTO integration_import_source_files(id,tenant_id,branch_id,upload_session_id,original_file_name,file_extension,declared_content_type,detected_content_type,file_format,size_bytes,sha256,storage_key,created_by)
    VALUES('p4-source',t::TEXT,b::TEXT,'p4-upload','history.zip','zip','application/zip','application/zip','zip',10,REPEAT('a',64),'p4/source',u);
  UPDATE integration_import_upload_sessions SET source_file_id='p4-source' WHERE id='p4-upload';
  INSERT INTO integration_import_jobs(id,tenant_id,branch_id,entity,file_name,mode,status,source_hash,source_type,source_file_id,created_by,owner_user_id,approval_status,approval_decided_at,approval_decided_by)
    VALUES('p4-job',t::TEXT,b::TEXT,'purchase-bills','history.zip','commit','completed',REPEAT('a',64),'csv|bills','p4-source',u,u,'approved',NOW(),u);
  INSERT INTO integration_migration_cutovers(tenant_id,branch_id,id,cutover_date,contract_version,created_by,business_timezone,cutover_at,historical_period_end,status,configured_by)
    VALUES(t,b,'p4-cutover',DATE '2026-07-29','three-layer-v1',u,'Asia/Kolkata',TIMESTAMPTZ '2026-07-29 00:00:00+05:30',TIMESTAMPTZ '2026-07-28 23:59:59+05:30','history_importing',u);

  INSERT INTO historical_purchase_bills(tenant_id,branch_id,provider,source_file_id,import_job_id,cutover_id,external_bill_id,supplier_name,invoice_number,invoice_date,received_date,line_total_paise,total_paise,original_json,source_checksum,created_by)
    SELECT t::TEXT,b::TEXT,'zenoti','p4-source','p4-job','p4-cutover','BILL-'||n,'Supplier '||n,'INV-'||n,DATE '2026-07-01',DATE '2026-07-01',300,300,JSONB_BUILD_OBJECT('bill',n),REPEAT('a',64),u FROM GENERATE_SERIES(1,1000) n;
  INSERT INTO historical_purchase_bill_lines(tenant_id,branch_id,historical_bill_id,original_product_name,source_product_id,source_line_id,mapped_inventory_item_id,purchased_quantity,accepted_quantity,unit_cost_paise,total_paise,batch_number,source_sheet,source_row_number,original_json,source_row_checksum)
    SELECT h.tenant_id,h.branch_id,h.id,'Color 4','COLOR-4','LINE-A',item,1,1,100,100,batch,'bills',row_number,'{}',checksum
    FROM historical_purchase_bills h CROSS JOIN (VALUES('A',2,REPEAT('b',64)),('B',3,REPEAT('c',64))) v(batch,row_number,checksum)
    WHERE h.import_job_id='p4-job';
  INSERT INTO historical_purchase_bill_lines(tenant_id,branch_id,historical_bill_id,original_product_name,source_product_id,source_line_id,purchased_quantity,accepted_quantity,unit_cost_paise,total_paise,batch_number,source_sheet,source_row_number,original_json,source_row_checksum)
    SELECT h.tenant_id,h.branch_id,h.id,'Legacy Unmapped','LEGACY','LINE-U',1,1,100,100,'U','bills',4,'{}',REPEAT('d',64) FROM historical_purchase_bills h WHERE h.import_job_id='p4-job';

  IF (SELECT COUNT(*) FROM historical_purchase_bills WHERE import_job_id='p4-job')<>1000
     OR (SELECT COUNT(*) FROM historical_purchase_bill_lines l JOIN historical_purchase_bills h ON h.id=l.historical_bill_id WHERE h.import_job_id='p4-job')<>3000
     OR (SELECT COUNT(*) FROM historical_purchase_bill_lines l JOIN historical_purchase_bills h ON h.id=l.historical_bill_id WHERE h.import_job_id='p4-job' AND l.mapped_inventory_item_id IS NULL)<>1000
  THEN RAISE EXCEPTION 'ARCHIVE_COVERAGE_FAILED'; END IF;
  IF (SELECT COALESCE(SUM(stock_quantity),0) FROM inventory_items WHERE tenant_id=t::TEXT AND branch_id=b::TEXT)<>stock
     OR (SELECT COUNT(*) FROM inventory_stock_ledger WHERE tenant_id=t::TEXT AND branch_id=b::TEXT)<>ledger
     OR (SELECT COUNT(*) FROM purchase_receipts WHERE tenant_id=t::TEXT AND branch_id=b::TEXT)<>receipts
     OR (SELECT COUNT(*) FROM accounting_journal_entries WHERE tenant_id=t::TEXT AND branch_id=b::TEXT)<>journals
  THEN RAISE EXCEPTION 'OPERATIONAL_STATE_CHANGED'; END IF;
  IF (SELECT COALESCE(SUM(l.debit_paise),0) FROM accounting_journal_lines l JOIN accounting_journal_entries e ON e.id=l.journal_entry_id WHERE e.tenant_id=t::TEXT AND e.branch_id=b::TEXT)<>debits
     OR (SELECT COALESCE(SUM(l.credit_paise),0) FROM accounting_journal_lines l JOIN accounting_journal_entries e ON e.id=l.journal_entry_id WHERE e.tenant_id=t::TEXT AND e.branch_id=b::TEXT)<>credits
  THEN RAISE EXCEPTION 'ACCOUNTING_BALANCE_CHANGED'; END IF;
  RAISE NOTICE 'PHASE4_ARCHIVE_1000_BILLS_PASS';
END $phase$;

DO $phase6$
DECLARE
  t TEXT; b TEXT; item TEXT; u TEXT; v_source_key TEXT; snapshot JSONB;
  mapping_id TEXT; stock BIGINT; ledger BIGINT; receipts BIGINT; journals BIGINT;
BEGIN
  SELECT tenant_id,branch_id,mapped_inventory_item_id INTO t,b,item
  FROM historical_purchase_bill_lines
  WHERE source_product_id='COLOR-4' LIMIT 1;
  SELECT id INTO u FROM users ORDER BY created_at LIMIT 1;
  SELECT source.source_key,source.source_snapshot INTO v_source_key,snapshot
  FROM historical_purchase_mapping_sources source
  WHERE source.tenant_id=t AND source.branch_id=b
    AND source.identity_type='product' AND source.provider='zenoti'
    AND source.source_snapshot->>'providerProductId'='COLOR-4';
  IF v_source_key IS NULL OR (snapshot->>'historicalQuantity')::BIGINT<>2000 THEN
    RAISE EXCEPTION 'PRODUCT_IDENTITY_AGGREGATION_FAILED';
  END IF;
  IF (SELECT COUNT(*) FROM historical_purchase_mapping_sources source
      WHERE source.tenant_id=t AND source.branch_id=b
        AND source.identity_type='vendor' AND source.provider='zenoti'
        AND source.source_snapshot->>'gstin'='')<>1000 THEN
    RAISE EXCEPTION 'VENDOR_WITHOUT_GSTIN_NOT_PRESERVED';
  END IF;

  SELECT COALESCE(SUM(stock_quantity),0) INTO stock
    FROM inventory_items WHERE tenant_id=t AND branch_id=b;
  SELECT COUNT(*) INTO ledger FROM inventory_stock_ledger WHERE tenant_id=t AND branch_id=b;
  SELECT COUNT(*) INTO receipts FROM purchase_receipts WHERE tenant_id=t AND branch_id=b;
  SELECT COUNT(*) INTO journals FROM accounting_journal_entries WHERE tenant_id=t AND branch_id=b;

  INSERT INTO historical_purchase_identity_mappings(
    tenant_id,branch_id,identity_type,provider,source_key,source_snapshot)
  VALUES(t,b,'product','zenoti',v_source_key,snapshot) RETURNING id INTO mapping_id;
  INSERT INTO historical_purchase_identity_mapping_versions(
    tenant_id,branch_id,identity_mapping_id,mapping_version,decision,
    source_snapshot,decision_evidence,warnings,approved_by)
  VALUES(t,b,mapping_id,1,'keep_historical_only',snapshot,
    '{"stockEffect":"none","accountingEffect":"none"}','[]',u);
  UPDATE historical_purchase_identity_mappings SET
    current_version=1,current_decision='keep_historical_only',updated_at=NOW()
  WHERE id=mapping_id;
  INSERT INTO historical_purchase_identity_mapping_versions(
    tenant_id,branch_id,identity_mapping_id,mapping_version,decision,
    target_inventory_item_id,source_snapshot,decision_evidence,warnings,approved_by)
  VALUES(t,b,mapping_id,2,'link',item,snapshot,
    '{"stockEffect":"none","accountingEffect":"none"}','[]',u);
  UPDATE historical_purchase_identity_mappings SET
    current_version=2,current_decision='link',target_inventory_item_id=item,updated_at=NOW()
  WHERE id=mapping_id;
  INSERT INTO historical_purchase_identity_mapping_versions(
    tenant_id,branch_id,identity_mapping_id,mapping_version,decision,
    source_snapshot,decision_evidence,warnings,approved_by,rollback_of_version)
  VALUES(t,b,mapping_id,3,'keep_historical_only',snapshot,
    '{"stockEffect":"none","accountingEffect":"none"}','[]',u,1);
  UPDATE historical_purchase_identity_mappings SET
    current_version=3,current_decision='keep_historical_only',
    target_inventory_item_id=NULL,updated_at=NOW()
  WHERE id=mapping_id;

  IF (SELECT COUNT(*) FROM historical_purchase_identity_mappings
      WHERE tenant_id=t AND branch_id=b AND identity_type='product'
        AND provider='zenoti' AND historical_purchase_identity_mappings.source_key=v_source_key)<>1
     OR (SELECT COUNT(*) FROM historical_purchase_identity_mapping_versions
         WHERE identity_mapping_id=mapping_id)<>3 THEN
    RAISE EXCEPTION 'MAPPING_VERSION_HISTORY_FAILED';
  END IF;
  IF (SELECT COALESCE(SUM(stock_quantity),0) FROM inventory_items
      WHERE tenant_id=t AND branch_id=b)<>stock
     OR (SELECT COUNT(*) FROM inventory_stock_ledger WHERE tenant_id=t AND branch_id=b)<>ledger
     OR (SELECT COUNT(*) FROM purchase_receipts WHERE tenant_id=t AND branch_id=b)<>receipts
     OR (SELECT COUNT(*) FROM accounting_journal_entries WHERE tenant_id=t AND branch_id=b)<>journals THEN
    RAISE EXCEPTION 'MAPPING_CHANGED_OPERATIONAL_STATE';
  END IF;
  RAISE NOTICE 'PHASE6_PRODUCT_VENDOR_MAPPING_PASS';
END $phase6$;
