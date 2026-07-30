ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS package_unit TEXT NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS units_per_package INTEGER NOT NULL DEFAULT 1;

ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS package_unit TEXT NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS stock_unit TEXT NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS units_per_package INTEGER NOT NULL DEFAULT 1;

ALTER TABLE purchase_receipt_lines
  ADD COLUMN IF NOT EXISTS package_unit TEXT NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS stock_unit TEXT NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS units_per_package INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_unit_cost_paise BIGINT NOT NULL DEFAULT 0;

UPDATE purchase_order_lines line
SET package_unit = item.unit,
    stock_unit = item.unit,
    units_per_package = 1
FROM inventory_items item
WHERE item.tenant_id = line.tenant_id
  AND item.branch_id = line.branch_id
  AND item.id = line.inventory_item_id
  AND line.stock_unit = 'pcs'
  AND line.package_unit = 'pcs'
  AND line.units_per_package = 1;

UPDATE purchase_receipt_lines line
SET package_unit = item.unit,
    stock_unit = item.unit,
    units_per_package = 1,
    stock_quantity = line.quantity,
    stock_unit_cost_paise = line.landed_unit_cost_paise
FROM inventory_items item
WHERE item.tenant_id = line.tenant_id
  AND item.branch_id = line.branch_id
  AND item.id = line.inventory_item_id
  AND line.stock_quantity = 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_units_per_package_positive') THEN
    ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_units_per_package_positive CHECK (units_per_package > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_lines_units_per_package_positive') THEN
    ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_units_per_package_positive CHECK (units_per_package > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_receipt_lines_package_stock_nonnegative') THEN
    ALTER TABLE purchase_receipt_lines ADD CONSTRAINT purchase_receipt_lines_package_stock_nonnegative CHECK (units_per_package > 0 AND stock_quantity >= 0 AND stock_unit_cost_paise >= 0);
  END IF;
END $$;
