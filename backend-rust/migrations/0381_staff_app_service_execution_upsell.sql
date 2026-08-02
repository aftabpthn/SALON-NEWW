ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS retail_price_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_retail_price_nonnegative;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_retail_price_nonnegative
  CHECK (retail_price_paise >= 0);

ALTER TABLE inventory_backbar_usage
  ADD COLUMN IF NOT EXISTS wasted_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selected_batch_id TEXT REFERENCES inventory_batches(id) ON DELETE RESTRICT;

ALTER TABLE inventory_backbar_usage DROP CONSTRAINT IF EXISTS inventory_backbar_usage_wasted_quantity_check;
ALTER TABLE inventory_backbar_usage ADD CONSTRAINT inventory_backbar_usage_wasted_quantity_check
  CHECK (wasted_quantity >= 0 AND wasted_quantity <= actual_quantity);

CREATE INDEX IF NOT EXISTS idx_inventory_backbar_usage_selected_batch
  ON inventory_backbar_usage(tenant_id,branch_id,selected_batch_id)
  WHERE selected_batch_id IS NOT NULL;
