ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS subcategory TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS product_usage TEXT NOT NULL DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS center_available BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS alert_level INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desired_level INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_level INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS safety_stock_level INTEGER NOT NULL DEFAULT 0;

UPDATE inventory_items item
SET product_usage = CASE
  WHEN item.dual_use_stock THEN 'dual_use'
  WHEN EXISTS (
    SELECT 1 FROM inventory_backbar_containers container
    WHERE container.tenant_id=item.tenant_id AND container.branch_id=item.branch_id
      AND container.inventory_item_id=item.id
  ) OR EXISTS (
    SELECT 1 FROM inventory_backbar_usage usage
    WHERE usage.tenant_id=item.tenant_id AND usage.branch_id=item.branch_id
      AND usage.inventory_item_id=item.id
  ) THEN 'consumable'
  ELSE 'retail'
END,
alert_level = CASE WHEN alert_level=0 THEN reorder_point ELSE alert_level END,
order_level = CASE WHEN order_level=0 THEN reorder_point ELSE order_level END,
desired_level = CASE WHEN desired_level=0 THEN reorder_point ELSE desired_level END
WHERE product_usage='retail' OR alert_level=0 OR order_level=0 OR desired_level=0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_items_product_usage_valid') THEN
    ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_product_usage_valid
      CHECK (product_usage IN ('retail','consumable','dual_use'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_items_phase1_levels_nonnegative') THEN
    ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_phase1_levels_nonnegative
      CHECK (alert_level>=0 AND desired_level>=0 AND order_level>=0 AND safety_stock_level>=0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_items_phase1_master
  ON inventory_items(tenant_id,branch_id,product_usage,category,subcategory,brand,center_available,active);

CREATE TABLE IF NOT EXISTS inventory_item_barcodes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL CHECK (BTRIM(barcode)<>''),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,branch_id,barcode)
);
CREATE INDEX IF NOT EXISTS idx_inventory_item_barcodes_item
  ON inventory_item_barcodes(tenant_id,branch_id,inventory_item_id,active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_item_primary_barcode
  ON inventory_item_barcodes(tenant_id,branch_id,inventory_item_id) WHERE is_primary AND active;

INSERT INTO inventory_item_barcodes(tenant_id,branch_id,inventory_item_id,barcode,is_primary)
SELECT tenant_id,branch_id,id,barcode,TRUE FROM inventory_items WHERE BTRIM(barcode)<>''
ON CONFLICT(tenant_id,branch_id,barcode) DO NOTHING;

CREATE TABLE IF NOT EXISTS inventory_uom_master (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('mass','volume','count','package')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO inventory_uom_master(code,label,dimension,sort_order) VALUES
  ('g','Gram','mass',10),('ml','Millilitre','volume',20),('oz','Ounce','mass',30),
  ('pcs','Piece','count',40),('bottle','Bottle','count',50),('kit','Kit','count',60),
  ('box','Box','package',110),('jar','Jar','package',120),('tube','Tube','package',130),
  ('pouch','Pouch','package',140),('pack','Pack','package',150)
ON CONFLICT(code) DO UPDATE SET label=EXCLUDED.label,dimension=EXCLUDED.dimension,
  sort_order=EXCLUDED.sort_order,active=TRUE,updated_at=NOW();

CREATE TABLE IF NOT EXISTS inventory_master_values (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('category','subcategory','brand','adjustment_reason','action_label')),
  code TEXT NOT NULL CHECK (BTRIM(code)<>''),
  label TEXT NOT NULL CHECK (BTRIM(label)<>''),
  parent_code TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_master_values_code
  ON inventory_master_values(tenant_id,branch_id,kind,LOWER(code));
CREATE INDEX IF NOT EXISTS idx_inventory_master_values_list
  ON inventory_master_values(tenant_id,branch_id,kind,active,label);

INSERT INTO inventory_master_values(tenant_id,branch_id,kind,code,label,created_by)
SELECT DISTINCT tenant_id,branch_id,'category',LOWER(REGEXP_REPLACE(BTRIM(category),'[^a-zA-Z0-9]+','-','g')),
  BTRIM(category),'migration' FROM inventory_items WHERE BTRIM(category)<>''
ON CONFLICT DO NOTHING;
INSERT INTO inventory_master_values(tenant_id,branch_id,kind,code,label,created_by)
SELECT DISTINCT tenant_id,branch_id,'brand',LOWER(REGEXP_REPLACE(BTRIM(brand),'[^a-zA-Z0-9]+','-','g')),
  BTRIM(brand),'migration' FROM inventory_items WHERE BTRIM(brand)<>''
ON CONFLICT DO NOTHING;

WITH scopes AS (SELECT DISTINCT tenant_id,branch_id FROM inventory_items), defaults(code,label) AS (
  VALUES ('adjustment','Adjustment'),('purchase','Purchase'),('purchase_return','Purchase Return'),
    ('transfer_out','Transfer Out'),('transfer_in','Transfer In'),('transfer_reversal','Transfer Reversal'),
    ('sale','Sale'),('return','Return'),('consumption','Consumption'),
    ('kit_component_out','Kit Component Out'),('kit_assembly_in','Kit Assembly In')
)
INSERT INTO inventory_master_values(tenant_id,branch_id,kind,code,label,created_by)
SELECT scopes.tenant_id,scopes.branch_id,'action_label',defaults.code,defaults.label,'migration'
FROM scopes CROSS JOIN defaults ON CONFLICT DO NOTHING;

WITH scopes AS (SELECT DISTINCT tenant_id,branch_id FROM inventory_items), defaults(code,label) AS (
  VALUES ('manual-stock-adjustment','Manual Stock Adjustment'),('physical-count-correction','Physical Count Correction'),
    ('damage','Damage'),('expiry','Expiry'),('waste','Waste'),('opening-stock','Opening Stock')
)
INSERT INTO inventory_master_values(tenant_id,branch_id,kind,code,label,created_by)
SELECT scopes.tenant_id,scopes.branch_id,'adjustment_reason',defaults.code,defaults.label,'migration'
FROM scopes CROSS JOIN defaults ON CONFLICT DO NOTHING;

ALTER TABLE supplier_inventory_terms
  ADD COLUMN IF NOT EXISTS vendor_part_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS purchase_unit TEXT NOT NULL DEFAULT 'pack',
  ADD COLUMN IF NOT EXISTS conversion_quantity INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS center_available BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE supplier_price_lists
  ADD COLUMN IF NOT EXISTS discount_bps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_percent INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='supplier_inventory_terms_conversion_positive') THEN
    ALTER TABLE supplier_inventory_terms ADD CONSTRAINT supplier_inventory_terms_conversion_positive
      CHECK (conversion_quantity>0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='supplier_inventory_terms_purchase_unit_valid') THEN
    ALTER TABLE supplier_inventory_terms ADD CONSTRAINT supplier_inventory_terms_purchase_unit_valid
      CHECK (purchase_unit IN ('box','jar','tube','pouch','pack','bottle','kit','pcs'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='supplier_price_lists_discount_valid') THEN
    ALTER TABLE supplier_price_lists ADD CONSTRAINT supplier_price_lists_discount_valid
      CHECK (discount_bps BETWEEN 0 AND 10000 AND gst_percent BETWEEN 0 AND 100);
  END IF;
END $$;

ALTER TABLE inventory_policies
  ADD COLUMN IF NOT EXISTS partial_delivery_policy TEXT NOT NULL DEFAULT 'allow',
  ADD COLUMN IF NOT EXISTS financial_lock_date DATE,
  ADD COLUMN IF NOT EXISTS edit_lock_days INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS master_edit_lock BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_policies_partial_delivery_valid') THEN
    ALTER TABLE inventory_policies ADD CONSTRAINT inventory_policies_partial_delivery_valid
      CHECK (partial_delivery_policy IN ('allow','block'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_policies_edit_lock_days_valid') THEN
    ALTER TABLE inventory_policies ADD CONSTRAINT inventory_policies_edit_lock_days_valid
      CHECK (edit_lock_days BETWEEN 0 AND 3650);
  END IF;
END $$;
