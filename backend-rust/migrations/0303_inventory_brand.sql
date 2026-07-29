ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_inventory_items_brand
  ON inventory_items (tenant_id, branch_id, LOWER(brand))
  WHERE brand <> '';
