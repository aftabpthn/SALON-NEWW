ALTER TABLE historical_purchase_bills
  ADD COLUMN IF NOT EXISTS supplier_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_email TEXT NOT NULL DEFAULT '';

ALTER TABLE historical_purchase_bill_lines
  ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS shade TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vendor_catalog_code TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS historical_purchase_identity_mappings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  identity_type TEXT NOT NULL CHECK(identity_type IN ('product','vendor')),
  provider TEXT NOT NULL,
  source_key TEXT NOT NULL CHECK(source_key ~ '^[0-9a-f]{64}$'),
  source_snapshot JSONB NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0 CHECK(current_version >= 0),
  current_decision TEXT CHECK(current_decision IN ('link','create','keep_historical_only','reject')),
  target_inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE RESTRICT,
  target_supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE(tenant_id,branch_id,identity_type,provider,source_key),
  CHECK(
    (identity_type='product' AND target_supplier_id IS NULL) OR
    (identity_type='vendor' AND target_inventory_item_id IS NULL)
  ),
  CHECK(
    current_decision IS NULL OR
    ((current_decision IN ('link','create')) =
      (COALESCE(target_inventory_item_id,target_supplier_id) IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS idx_historical_identity_mapping_scope
  ON historical_purchase_identity_mappings
  (tenant_id,branch_id,identity_type,provider,updated_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS historical_purchase_identity_mapping_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  identity_mapping_id TEXT NOT NULL REFERENCES historical_purchase_identity_mappings(id) ON DELETE RESTRICT,
  mapping_version INTEGER NOT NULL CHECK(mapping_version > 0),
  decision TEXT NOT NULL CHECK(decision IN ('link','create','keep_historical_only','reject')),
  target_inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE RESTRICT,
  target_supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  source_snapshot JSONB NOT NULL,
  decision_evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  warnings JSONB NOT NULL DEFAULT '[]'::JSONB,
  reason TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL REFERENCES users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rollback_of_version INTEGER,
  UNIQUE(identity_mapping_id,mapping_version),
  CHECK(
    (decision IN ('link','create')) =
      (COALESCE(target_inventory_item_id,target_supplier_id) IS NOT NULL)
  ),
  CHECK(NOT(target_inventory_item_id IS NOT NULL AND target_supplier_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_historical_identity_mapping_versions_scope
  ON historical_purchase_identity_mapping_versions
  (tenant_id,branch_id,identity_mapping_id,mapping_version DESC);

CREATE OR REPLACE FUNCTION validate_historical_identity_mapping_scope()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant TEXT;
  v_branch TEXT;
  v_kind TEXT;
BEGIN
  IF TG_TABLE_NAME='historical_purchase_identity_mapping_versions' THEN
    SELECT tenant_id,branch_id,identity_type INTO v_tenant,v_branch,v_kind
    FROM historical_purchase_identity_mappings WHERE id=NEW.identity_mapping_id;
    IF v_tenant IS DISTINCT FROM NEW.tenant_id OR v_branch IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HISTORICAL_MAPPING_SCOPE_MISMATCH';
    END IF;
  ELSE
    v_kind := NEW.identity_type;
  END IF;

  IF NEW.target_inventory_item_id IS NOT NULL AND (
    v_kind<>'product' OR NOT EXISTS(
      SELECT 1 FROM inventory_items item
      WHERE item.id=NEW.target_inventory_item_id
        AND item.tenant_id=NEW.tenant_id AND item.branch_id=NEW.branch_id
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HISTORICAL_MAPPING_PRODUCT_SCOPE_MISMATCH';
  END IF;
  IF NEW.target_supplier_id IS NOT NULL AND (
    v_kind<>'vendor' OR NOT EXISTS(
      SELECT 1 FROM suppliers supplier
      WHERE supplier.id=NEW.target_supplier_id
        AND supplier.tenant_id=NEW.tenant_id AND supplier.branch_id=NEW.branch_id
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HISTORICAL_MAPPING_VENDOR_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historical_identity_mapping_scope
  ON historical_purchase_identity_mappings;
CREATE TRIGGER trg_historical_identity_mapping_scope
BEFORE INSERT OR UPDATE ON historical_purchase_identity_mappings
FOR EACH ROW EXECUTE FUNCTION validate_historical_identity_mapping_scope();

DROP TRIGGER IF EXISTS trg_historical_identity_mapping_version_scope
  ON historical_purchase_identity_mapping_versions;
CREATE TRIGGER trg_historical_identity_mapping_version_scope
BEFORE INSERT ON historical_purchase_identity_mapping_versions
FOR EACH ROW EXECUTE FUNCTION validate_historical_identity_mapping_scope();

DROP TRIGGER IF EXISTS trg_historical_identity_mapping_versions_immutable
  ON historical_purchase_identity_mapping_versions;
CREATE TRIGGER trg_historical_identity_mapping_versions_immutable
BEFORE UPDATE OR DELETE ON historical_purchase_identity_mapping_versions
FOR EACH ROW EXECUTE FUNCTION protect_historical_purchase_archive();

CREATE OR REPLACE VIEW historical_purchase_mapping_sources AS
SELECT
  line.tenant_id,
  line.branch_id,
  'product'::TEXT identity_type,
  bill.provider,
  ENCODE(DIGEST(CONCAT_WS('|',
    bill.provider,
    CASE
      WHEN BTRIM(line.source_product_id)<>'' THEN 'provider:'||LOWER(BTRIM(line.source_product_id))
      WHEN BTRIM(line.sku)<>'' THEN 'sku:'||LOWER(BTRIM(line.sku))
      WHEN BTRIM(line.barcode)<>'' THEN 'barcode:'||LOWER(BTRIM(line.barcode))
      ELSE CONCAT_WS(':','attributes',
        REGEXP_REPLACE(LOWER(BTRIM(line.original_product_name)),'[^a-z0-9]+','','g'),
        REGEXP_REPLACE(LOWER(BTRIM(line.brand)),'[^a-z0-9]+','','g'),
        REGEXP_REPLACE(LOWER(BTRIM(line.stock_unit)),'[^a-z0-9]+','','g'),
        REGEXP_REPLACE(LOWER(BTRIM(line.size)),'[^a-z0-9]+','','g'),
        REGEXP_REPLACE(LOWER(BTRIM(line.shade)),'[^a-z0-9]+','','g'),
        REGEXP_REPLACE(LOWER(BTRIM(line.color)),'[^a-z0-9]+','','g'),
        REGEXP_REPLACE(LOWER(BTRIM(line.vendor_catalog_code)),'[^a-z0-9]+','','g')
      )
    END
  ),'sha256'),'hex') source_key,
  JSONB_BUILD_OBJECT(
    'providerProductId',line.source_product_id,
    'sku',line.sku,'barcode',line.barcode,
    'name',line.original_product_name,'normalizedName',
      REGEXP_REPLACE(LOWER(BTRIM(line.original_product_name)),'[^a-z0-9]+','','g'),
    'brand',line.brand,'unit',line.stock_unit,'packageUnit',line.package_unit,
    'unitsPerPackage',line.units_per_package,'size',line.size,'shade',line.shade,
    'color',line.color,'vendorCatalogCode',line.vendor_catalog_code,
    'billCount',COUNT(DISTINCT bill.id),'lineCount',COUNT(*),
    'historicalQuantity',SUM(line.purchased_quantity)
  ) source_snapshot
FROM historical_purchase_bill_lines line
JOIN historical_purchase_bills bill
  ON bill.id=line.historical_bill_id
 AND bill.tenant_id=line.tenant_id AND bill.branch_id=line.branch_id
GROUP BY line.tenant_id,line.branch_id,bill.provider,line.source_product_id,line.sku,line.barcode,
  line.original_product_name,line.brand,line.stock_unit,line.package_unit,line.units_per_package,
  line.size,line.shade,line.color,line.vendor_catalog_code
UNION ALL
SELECT
  bill.tenant_id,
  bill.branch_id,
  'vendor'::TEXT identity_type,
  bill.provider,
  ENCODE(DIGEST(CONCAT_WS('|',
    bill.provider,
    CASE
      WHEN BTRIM(bill.supplier_external_id)<>'' THEN 'provider:'||LOWER(BTRIM(bill.supplier_external_id))
      WHEN BTRIM(bill.supplier_gstin)<>'' THEN 'gstin:'||UPPER(BTRIM(bill.supplier_gstin))
      WHEN BTRIM(bill.supplier_code)<>'' THEN 'code:'||LOWER(BTRIM(bill.supplier_code))
      ELSE CONCAT_WS(':','attributes',
        REGEXP_REPLACE(LOWER(BTRIM(bill.supplier_name)),'[^a-z0-9]+','','g'),
        REGEXP_REPLACE(LOWER(BTRIM(bill.supplier_phone)),'[^0-9]+','','g'),
        LOWER(BTRIM(bill.supplier_email))
      )
    END
  ),'sha256'),'hex') source_key,
  JSONB_BUILD_OBJECT(
    'providerVendorId',bill.supplier_external_id,'gstin',bill.supplier_gstin,
    'vendorCode',bill.supplier_code,'name',bill.supplier_name,'normalizedName',
      REGEXP_REPLACE(LOWER(BTRIM(bill.supplier_name)),'[^a-z0-9]+','','g'),
    'phone',bill.supplier_phone,'email',bill.supplier_email,
    'billCount',COUNT(*)
  ) source_snapshot
FROM historical_purchase_bills bill
GROUP BY bill.tenant_id,bill.branch_id,bill.provider,bill.supplier_external_id,
  bill.supplier_gstin,bill.supplier_code,bill.supplier_name,bill.supplier_phone,bill.supplier_email;
