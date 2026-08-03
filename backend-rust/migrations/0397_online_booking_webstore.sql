ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS online_sale_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_online_sale_valid;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_online_sale_valid
  CHECK (NOT online_sale_enabled OR product_usage IN ('retail','dual_use'));

CREATE INDEX IF NOT EXISTS idx_inventory_items_webstore
  ON inventory_items (tenant_id,branch_id,name)
  WHERE active=TRUE AND center_available=TRUE AND online_sale_enabled=TRUE;
