CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_inventory_items_name_trgm
  ON inventory_items USING gin (LOWER(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_items_sku_trgm
  ON inventory_items USING gin (LOWER(sku) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_items_category_trgm
  ON inventory_items USING gin (LOWER(category) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_items_barcode_trgm
  ON inventory_items USING gin (LOWER(barcode) gin_trgm_ops);
