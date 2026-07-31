CREATE TABLE IF NOT EXISTS historical_purchase_bills (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  import_job_id TEXT NOT NULL REFERENCES integration_import_jobs(id) ON DELETE RESTRICT,
  cutover_id TEXT NOT NULL,
  external_bill_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_gstin TEXT NOT NULL DEFAULT '',
  supplier_external_id TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  received_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency ~ '^[A-Z]{3}$'),
  document_type TEXT NOT NULL DEFAULT 'bill',
  source_status TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT '',
  taxable_paise BIGINT NOT NULL DEFAULT 0,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  discount_paise BIGINT NOT NULL DEFAULT 0,
  shipping_paise BIGINT NOT NULL DEFAULT 0,
  handling_paise BIGINT NOT NULL DEFAULT 0,
  line_total_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL DEFAULT 0,
  original_json JSONB NOT NULL,
  source_checksum TEXT NOT NULL CHECK(source_checksum ~ '^[0-9A-Fa-f]{64}$'),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, branch_id, source_file_id, cutover_id, external_bill_id),
  FOREIGN KEY(tenant_id, branch_id, source_file_id)
    REFERENCES integration_import_source_files(tenant_id, branch_id, id) ON DELETE RESTRICT
);

ALTER TABLE integration_import_source_artifacts
  DROP CONSTRAINT IF EXISTS integration_import_source_artifacts_file_format_check;
ALTER TABLE integration_import_source_artifacts
  ADD CONSTRAINT integration_import_source_artifacts_file_format_check
  CHECK(file_format IN ('csv','xlsx','pdf','png','jpeg','webp'));

CREATE INDEX IF NOT EXISTS idx_historical_purchase_bills_scope
  ON historical_purchase_bills(tenant_id, branch_id, invoice_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_purchase_bills_supplier
  ON historical_purchase_bills(tenant_id, branch_id, supplier_name, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_purchase_bills_cutover
  ON historical_purchase_bills(tenant_id, branch_id, cutover_id, import_job_id);

CREATE TABLE IF NOT EXISTS historical_purchase_bill_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  historical_bill_id TEXT NOT NULL REFERENCES historical_purchase_bills(id) ON DELETE CASCADE,
  original_product_name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  source_product_id TEXT NOT NULL DEFAULT '',
  source_line_id TEXT NOT NULL DEFAULT '',
  mapped_inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE RESTRICT,
  package_unit TEXT NOT NULL DEFAULT '',
  stock_unit TEXT NOT NULL DEFAULT '',
  units_per_package BIGINT NOT NULL DEFAULT 1 CHECK(units_per_package > 0),
  purchased_quantity BIGINT NOT NULL,
  accepted_quantity BIGINT NOT NULL DEFAULT 0,
  damaged_quantity BIGINT NOT NULL DEFAULT 0,
  rejected_quantity BIGINT NOT NULL DEFAULT 0,
  unit_cost_paise BIGINT NOT NULL,
  gst_percent_bps INTEGER NOT NULL DEFAULT 0,
  taxable_paise BIGINT NOT NULL DEFAULT 0,
  cgst_paise BIGINT NOT NULL DEFAULT 0,
  sgst_paise BIGINT NOT NULL DEFAULT 0,
  igst_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL,
  batch_number TEXT NOT NULL DEFAULT '',
  expiry_date DATE,
  source_sheet TEXT NOT NULL DEFAULT '',
  source_row_number INTEGER NOT NULL CHECK(source_row_number > 0),
  original_json JSONB NOT NULL,
  source_row_checksum TEXT NOT NULL CHECK(source_row_checksum ~ '^[0-9A-Fa-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(historical_bill_id, source_sheet, source_row_number)
);

CREATE INDEX IF NOT EXISTS idx_historical_purchase_bill_lines_scope
  ON historical_purchase_bill_lines(tenant_id, branch_id, historical_bill_id, source_row_number);
CREATE INDEX IF NOT EXISTS idx_historical_purchase_bill_lines_product
  ON historical_purchase_bill_lines(tenant_id, branch_id, mapped_inventory_item_id)
  WHERE mapped_inventory_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_historical_purchase_bill_lines_unmapped
  ON historical_purchase_bill_lines(tenant_id, branch_id, historical_bill_id)
  WHERE mapped_inventory_item_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_purchase_bill_lines_source_identity
  ON historical_purchase_bill_lines(historical_bill_id, source_line_id, batch_number)
  WHERE source_line_id<>'';

CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_purchase_bills_provider_supplier_invoice
  ON historical_purchase_bills(tenant_id,branch_id,cutover_id,LOWER(provider),LOWER(supplier_external_id),LOWER(invoice_number))
  WHERE supplier_external_id<>'';
CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_purchase_bills_gstin_invoice
  ON historical_purchase_bills(tenant_id,branch_id,cutover_id,UPPER(supplier_gstin),LOWER(invoice_number))
  WHERE supplier_gstin<>'';
CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_purchase_bills_supplier_date_invoice
  ON historical_purchase_bills(tenant_id,branch_id,cutover_id,LOWER(supplier_name),LOWER(invoice_number),invoice_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_purchase_bills_provider_external
  ON historical_purchase_bills(tenant_id,branch_id,cutover_id,LOWER(provider),LOWER(external_bill_id));

CREATE TABLE IF NOT EXISTS historical_purchase_bill_files (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  historical_bill_id TEXT NOT NULL REFERENCES historical_purchase_bills(id) ON DELETE CASCADE,
  source_file_id TEXT NOT NULL,
  source_artifact_id TEXT REFERENCES integration_import_source_artifacts(id) ON DELETE RESTRICT,
  original_file_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(sha256 ~ '^[0-9A-Fa-f]{64}$'),
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(historical_bill_id, source_file_id, source_artifact_id),
  FOREIGN KEY(tenant_id, branch_id, source_file_id)
    REFERENCES integration_import_source_files(tenant_id, branch_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_historical_purchase_bill_files_scope
  ON historical_purchase_bill_files(tenant_id, branch_id, historical_bill_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_purchase_bill_files_evidence
  ON historical_purchase_bill_files(historical_bill_id, source_file_id, COALESCE(source_artifact_id,''));

CREATE TABLE IF NOT EXISTS historical_purchase_product_mappings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  historical_bill_line_id TEXT NOT NULL REFERENCES historical_purchase_bill_lines(id) ON DELETE CASCADE,
  mapping_version INTEGER NOT NULL CHECK(mapping_version > 0),
  original_product_name TEXT NOT NULL,
  source_product_id TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  mapped_inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE RESTRICT,
  mapping_status TEXT NOT NULL CHECK(mapping_status IN ('mapped','unmapped')),
  mapping_source TEXT NOT NULL DEFAULT 'migration',
  approved_by TEXT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(historical_bill_line_id, mapping_version),
  CHECK((mapping_status='mapped')=(mapped_inventory_item_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_historical_purchase_product_mappings_scope
  ON historical_purchase_product_mappings(tenant_id, branch_id, historical_bill_line_id, mapping_version DESC);
CREATE INDEX IF NOT EXISTS idx_historical_purchase_product_mappings_unmapped
  ON historical_purchase_product_mappings(tenant_id, branch_id, created_at DESC)
  WHERE mapping_status='unmapped';

CREATE OR REPLACE FUNCTION validate_historical_purchase_archive_scope()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant TEXT;
  v_branch TEXT;
  v_item_id TEXT := TO_JSONB(NEW)->>'mapped_inventory_item_id';
BEGIN
  IF TG_TABLE_NAME='historical_purchase_bills' THEN
    IF NOT EXISTS(
      SELECT 1 FROM integration_migration_cutovers cutover
      WHERE cutover.tenant_id::TEXT=NEW.tenant_id
        AND cutover.branch_id::TEXT=NEW.branch_id
        AND cutover.id=NEW.cutover_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HISTORICAL_PURCHASE_CUTOVER_NOT_FOUND';
    END IF;
  ELSIF TG_TABLE_NAME='historical_purchase_bill_lines' THEN
    SELECT tenant_id,branch_id INTO v_tenant,v_branch
    FROM historical_purchase_bills WHERE id=NEW.historical_bill_id;
  ELSIF TG_TABLE_NAME='historical_purchase_bill_files' THEN
    SELECT tenant_id,branch_id INTO v_tenant,v_branch
    FROM historical_purchase_bills WHERE id=NEW.historical_bill_id;
  ELSE
    SELECT line.tenant_id,line.branch_id INTO v_tenant,v_branch
    FROM historical_purchase_bill_lines line WHERE line.id=NEW.historical_bill_line_id;
  END IF;

  IF TG_TABLE_NAME<>'historical_purchase_bills'
     AND (v_tenant IS DISTINCT FROM NEW.tenant_id OR v_branch IS DISTINCT FROM NEW.branch_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HISTORICAL_PURCHASE_SCOPE_MISMATCH';
  END IF;
  IF TG_TABLE_NAME IN ('historical_purchase_bill_lines','historical_purchase_product_mappings')
     AND v_item_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM inventory_items item
    WHERE item.id=v_item_id
      AND item.tenant_id=NEW.tenant_id AND item.branch_id=NEW.branch_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HISTORICAL_PURCHASE_PRODUCT_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_historical_purchase_archive()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP='DELETE' AND CURRENT_SETTING('aurashine.historical_archive_rollback',TRUE)='on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='historical_purchase_bills'
     AND CURRENT_SETTING('aurashine.historical_archive_write',TRUE)='on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HISTORICAL_PURCHASE_ARCHIVE_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historical_purchase_bills_scope ON historical_purchase_bills;
CREATE TRIGGER trg_historical_purchase_bills_scope
BEFORE INSERT ON historical_purchase_bills
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_archive_scope();
DROP TRIGGER IF EXISTS trg_historical_purchase_bill_lines_scope ON historical_purchase_bill_lines;
CREATE TRIGGER trg_historical_purchase_bill_lines_scope
BEFORE INSERT ON historical_purchase_bill_lines
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_archive_scope();
DROP TRIGGER IF EXISTS trg_historical_purchase_bill_files_scope ON historical_purchase_bill_files;
CREATE TRIGGER trg_historical_purchase_bill_files_scope
BEFORE INSERT ON historical_purchase_bill_files
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_archive_scope();
DROP TRIGGER IF EXISTS trg_historical_purchase_product_mappings_scope ON historical_purchase_product_mappings;
CREATE TRIGGER trg_historical_purchase_product_mappings_scope
BEFORE INSERT ON historical_purchase_product_mappings
FOR EACH ROW EXECUTE FUNCTION validate_historical_purchase_archive_scope();

DROP TRIGGER IF EXISTS trg_historical_purchase_bills_immutable ON historical_purchase_bills;
CREATE TRIGGER trg_historical_purchase_bills_immutable
BEFORE UPDATE OR DELETE ON historical_purchase_bills
FOR EACH ROW EXECUTE FUNCTION protect_historical_purchase_archive();
DROP TRIGGER IF EXISTS trg_historical_purchase_bill_lines_immutable ON historical_purchase_bill_lines;
CREATE TRIGGER trg_historical_purchase_bill_lines_immutable
BEFORE UPDATE OR DELETE ON historical_purchase_bill_lines
FOR EACH ROW EXECUTE FUNCTION protect_historical_purchase_archive();
DROP TRIGGER IF EXISTS trg_historical_purchase_bill_files_immutable ON historical_purchase_bill_files;
CREATE TRIGGER trg_historical_purchase_bill_files_immutable
BEFORE UPDATE OR DELETE ON historical_purchase_bill_files
FOR EACH ROW EXECUTE FUNCTION protect_historical_purchase_archive();
DROP TRIGGER IF EXISTS trg_historical_purchase_product_mappings_immutable ON historical_purchase_product_mappings;
CREATE TRIGGER trg_historical_purchase_product_mappings_immutable
BEFORE UPDATE OR DELETE ON historical_purchase_product_mappings
FOR EACH ROW EXECUTE FUNCTION protect_historical_purchase_archive();
